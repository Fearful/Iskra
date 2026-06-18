import Ajv from 'ajv';
import ajvErrors from 'ajv-errors';
import addFormats from 'ajv-formats';
import { REDIS_KEYS, FormStatus, QUEUE_NAMES, JOB_NAMES } from '@forms-app/shared';
import type { FormMeta } from '@forms-app/shared';
import { createHash } from 'crypto';

// addFormats registers the standard string formats (email, date, uri, ...).
// Without it, AJV's strict mode throws on `format` keywords, so any form with an
// email or date field would crash server-side validation.
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
ajvErrors(ajv);

// In-memory cache for form schemas (TTL-based)
const schemaCache = new Map<string, { schema: any; meta: FormMeta; cachedAt: number }>();
const CACHE_TTL_MS = 30_000; // 30 seconds

export class SubmissionService {
    private static redis: any;
    private static worker: any;

    static setRedis(redis: any) {
        this.redis = redis;
    }

    static setWorker(worker: any) {
        this.worker = worker;
    }

    static async getFormData(
        spaceSlug: string,
        formSlug: string,
    ): Promise<{ schema: any; meta: FormMeta } | null> {
        const cacheKey = `${spaceSlug}:${formSlug}`;
        const cached = schemaCache.get(cacheKey);

        if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
            return { schema: cached.schema, meta: cached.meta };
        }

        if (!this.redis) return null;

        const [schemaJson, metaJson] = await Promise.all([
            this.redis.get(REDIS_KEYS.formSchema(spaceSlug, formSlug)),
            this.redis.get(REDIS_KEYS.formMeta(spaceSlug, formSlug)),
        ]);

        if (!schemaJson || !metaJson) return null;

        const schema = JSON.parse(schemaJson);
        const meta: FormMeta = JSON.parse(metaJson);

        schemaCache.set(cacheKey, { schema, meta, cachedAt: Date.now() });

        return { schema, meta };
    }

    static validateAnswer(
        schema: any,
        data: Record<string, unknown>,
    ): { valid: boolean; errors: Record<string, string> } {
        const validate = ajv.compile(schema);
        const valid = validate(data);

        if (valid) {
            return { valid: true, errors: {} };
        }

        const errors: Record<string, string> = {};
        for (const err of validate.errors ?? []) {
            const field = err.instancePath?.replace('/', '') || err.params?.missingProperty;
            if (field) {
                errors[field] = err.message ?? 'Invalid value';
            }
        }

        return { valid: false, errors };
    }

    static hashIp(ip: string): string {
        const dailySalt = new Date().toISOString().slice(0, 10);
        return createHash('sha256').update(`${ip}:${dailySalt}`).digest('hex');
    }

    static async enqueueAnswer(
        formId: string,
        data: Record<string, unknown>,
        ipHash: string,
        recaptchaScore: number,
    ): Promise<void> {
        if (!this.worker) {
            throw new Error('Worker not initialized');
        }

        await this.worker.enqueue(JOB_NAMES.ANSWER_SUBMIT, {
            formId,
            data,
            ipHash,
            recaptchaScore: Math.round(recaptchaScore * 100),
        });
    }
}
