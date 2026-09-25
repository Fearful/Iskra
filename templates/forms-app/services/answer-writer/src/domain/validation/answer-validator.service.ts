import Ajv, { type ValidateFunction } from 'ajv';
import ajvErrors from 'ajv-errors';
import addFormats from 'ajv-formats';
import { UnrecoverableError } from 'bullmq';
import { eq } from 'drizzle-orm';
import { forms } from '@forms-app/shared/db';
import { FormStatus, type AnswerJob } from '@forms-app/shared';

// The same AJV setup as forms-api's SubmissionService: an answer forms-api
// accepted has to pass here too.
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
ajvErrors(ajv);

/** How long a form's status and compiled schema are used before Postgres is read again. */
const CACHE_TTL_MS = 30_000;

/**
 * forms-api accepts an answer while the form is open, and it reaches this
 * worker seconds later (longer with a backlog), when the cron may have closed
 * the form: answers are still stored this long after the form's end date.
 */
export const CLOSE_GRACE_MS = 5 * 60_000;

interface CachedForm {
    status: string;
    endsAt: Date | null;
    schemaJson: string;
    validate: ValidateFunction;
    cachedAt: number;
}

/** What forms-api enqueues: a hex HMAC as ipHash, the reCAPTCHA score as an integer percentage. */
function isAnswerJob(job: unknown): job is AnswerJob {
    if (typeof job !== 'object' || job === null) return false;
    const { formId, data, ipHash, recaptchaScore } = job as Record<string, unknown>;
    return (
        typeof formId === 'string' &&
        typeof data === 'object' &&
        data !== null &&
        !Array.isArray(data) &&
        typeof ipHash === 'string' &&
        /^[0-9a-f]{64}$/.test(ipHash) &&
        typeof recaptchaScore === 'number' &&
        Number.isInteger(recaptchaScore) &&
        recaptchaScore >= 0 &&
        recaptchaScore <= 100
    );
}

function acceptsAnswers(form: CachedForm, now: number): boolean {
    if (form.status === FormStatus.OPEN) return true;
    return form.status === FormStatus.CLOSED && form.endsAt !== null && now - form.endsAt.getTime() <= CLOSE_GRACE_MS;
}

/** Why `job` cannot be stored in `form`, or null when it can. */
function problemWith(form: CachedForm | null, job: AnswerJob): string | null {
    if (!form) return `Form not found: ${job.formId}`;
    if (!acceptsAnswers(form, Date.now())) return `Form ${job.formId} is not accepting answers (${form.status})`;
    if (form.validate(job.data)) return null;
    // Paths and rules only: the answer's values stay out of the logs.
    const errors = (form.validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.keyword}`);
    return `Invalid answer for form ${job.formId}: ${errors.join(', ')}`;
}

/**
 * Checks each queued answer before it is stored: answers were inserted as
 * they came out of Redis, so anyone who could write to the queue (or a
 * compromised forms-api) could store anything, in any form. The job must have
 * forms-api's shape, its form must exist and be open, and its data must pass
 * the form's JSON Schema from Postgres.
 */
export class AnswerValidatorService {
    private static db: any;
    private static cache = new Map<string, CachedForm>();

    static setDb(db: any) {
        this.db = db;
        this.cache.clear();
    }

    /**
     * Returns the job when it can be stored. Otherwise throws BullMQ's
     * UnrecoverableError: the job fails at once instead of being retried, as
     * it could never succeed.
     */
    static async validate(job: unknown): Promise<AnswerJob> {
        if (!isAnswerJob(job)) throw new UnrecoverableError('Malformed answer job');

        // The cache only ever passes an answer: a rejection is decided on a
        // fresh read, so a form opened or edited seconds ago loses nothing.
        const cached = this.cache.get(job.formId);
        if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS && !problemWith(cached, job)) return job;

        const problem = problemWith(await this.loadForm(job.formId, cached), job);
        if (problem) throw new UnrecoverableError(problem);
        return job;
    }

    private static async loadForm(formId: string, cached: CachedForm | undefined): Promise<CachedForm | null> {
        const [row] = await this.db
            .select({ status: forms.status, endsAt: forms.endsAt, validationSchema: forms.validationSchema })
            .from(forms)
            .where(eq(forms.id, formId));
        if (!row?.validationSchema) {
            this.cache.delete(formId);
            return null;
        }

        const schemaJson = JSON.stringify(row.validationSchema);
        let validate = cached?.schemaJson === schemaJson ? cached.validate : undefined;
        if (!validate) {
            validate = ajv.compile(row.validationSchema);
            // Out of AJV's own cache, which keeps every schema object it
            // compiled: one per read would pile up.
            ajv.removeSchema(row.validationSchema);
        }
        const form = { status: row.status, endsAt: row.endsAt, schemaJson, validate, cachedAt: Date.now() };
        this.cache.set(formId, form);
        return form;
    }
}
