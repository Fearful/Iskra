import { afterEach, describe, expect, it } from 'bun:test';
import { UnrecoverableError } from 'bullmq';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { AnswerValidatorService, CLOSE_GRACE_MS } from '../src/domain/validation/answer-validator.service.ts';
import { WriterService } from '../src/domain/writer/writer.service.ts';
import { handleAnswerJob } from '../src/domain/answer-job.ts';
import { SubmissionService } from '../../forms-api/src/domain/submission/submission.service.ts';
import { generateJsonSchema } from '../../admin-api/src/domain/forms/schema-generator.ts';
import type { FormsDb } from '@forms-app/shared/db/client';

const field = (o: Record<string, unknown>) => ({
    label: 'L',
    maxLength: null,
    min: null,
    max: null,
    options: null,
    errorMessage: null,
    required: false,
    ...o,
});

const FIELDS = [
    field({ fieldType: 'email', name: 'mail', required: true }),
    field({ fieldType: 'number', name: 'age', min: 18, max: 99 }),
    field({ fieldType: 'checkbox', name: 'terms', required: true }),
    field({ fieldType: 'select', name: 'color', options: [{ label: 'Red', value: 'red' }] }),
];
// The schema admin-api generates for a form, as stored in forms.validation_schema.
const SCHEMA = generateJsonSchema(FIELDS as any);

const IP_HASH = SubmissionService.hashIp('203.0.113.7', 'secret');
const VALID = { mail: 'ada@example.com', age: 36, terms: true, color: 'red' };

/** A Drizzle-ish db holding one row per form id; counts the queries and keeps the inserted answers. */
function fakeDb(rows: Record<string, { status: string; endsAt: Date | null; validationSchema: unknown }>) {
    const dialect = new PgDialect();
    const db = {
        queries: 0,
        inserted: [] as Record<string, unknown>[],
        insert: () => ({
            values: async (values: Record<string, unknown> | Record<string, unknown>[]) => {
                db.inserted.push(...[values].flat());
            },
        }),
        select: () => ({
            from: () => ({
                where: async (condition: SQL) => {
                    db.queries++;
                    // The id in `eq(forms.id, id)`.
                    const [id] = dialect.sqlToQuery(condition).params as string[];
                    return rows[id] ? [rows[id]] : [];
                },
            }),
        }),
    };
    return db;
}

const job = (overrides: Record<string, unknown> = {}) => ({
    formId: 'open-form',
    data: VALID,
    ipHash: IP_HASH,
    recaptchaScore: 90,
    ...overrides,
});

async function rejection(promise: Promise<unknown>): Promise<Error> {
    try {
        await promise;
    } catch (err) {
        return err as Error;
    }
    throw new Error('expected a rejection');
}

const realNow = Date.now;
afterEach(() => {
    Date.now = realNow;
});

describe('AnswerValidatorService.validate', () => {
    const minutesAgo = (m: number) => new Date(realNow() - m * 60_000);
    const db = () =>
        fakeDb({
            'open-form': { status: 'open', endsAt: null, validationSchema: SCHEMA },
            'draft-form': { status: 'draft', endsAt: null, validationSchema: SCHEMA },
            'scheduled-form': { status: 'scheduled', endsAt: null, validationSchema: SCHEMA },
            'just-closed': { status: 'closed', endsAt: minutesAgo(1), validationSchema: SCHEMA },
            'long-closed': { status: 'closed', endsAt: minutesAgo(60), validationSchema: SCHEMA },
        });

    it('passes an answer forms-api would accept', async () => {
        AnswerValidatorService.setDb(db() as unknown as FormsDb);
        expect(await AnswerValidatorService.validate(job())).toEqual(job());
    });

    it('fails, without retries, an answer that breaks the form schema', async () => {
        // Answers used to be stored as they came out of the queue.
        AnswerValidatorService.setDb(db() as unknown as FormsDb);
        for (const data of [
            { ...VALID, mail: 'not-an-email' },
            { ...VALID, age: 7 },
            { ...VALID, terms: false },
            { ...VALID, color: 'blue' },
            { ...VALID, injected: '<script>alert(1)</script>' },
            { age: 36 },
        ]) {
            const err = await rejection(AnswerValidatorService.validate(job({ data })));
            expect(err).toBeInstanceOf(UnrecoverableError);
            expect(err.message).toStartWith('Invalid answer for form open-form');
            // Only paths and rules reach the logs, never the values.
            expect(err.message).not.toContain('<script>');
            expect(err.message).not.toContain('not-an-email');
        }
    });

    it('fails an answer for a form that does not exist or is not open', async () => {
        AnswerValidatorService.setDb(db() as unknown as FormsDb);
        for (const [formId, message] of [
            ['missing-form', 'Form not found'],
            ['draft-form', 'not accepting answers (draft)'],
            ['scheduled-form', 'not accepting answers (scheduled)'],
            ['long-closed', 'not accepting answers (closed)'],
        ]) {
            const err = await rejection(AnswerValidatorService.validate(job({ formId })));
            expect(err).toBeInstanceOf(UnrecoverableError);
            expect(err.message).toContain(message);
        }
    });

    it('stores answers still in the queue when their form closed a moment ago', async () => {
        AnswerValidatorService.setDb(db() as unknown as FormsDb);
        expect(CLOSE_GRACE_MS).toBeGreaterThan(60_000);
        expect(await AnswerValidatorService.validate(job({ formId: 'just-closed' }))).toEqual(
            job({ formId: 'just-closed' }),
        );
    });

    it('fails a job without the shape forms-api enqueues', async () => {
        AnswerValidatorService.setDb(db() as unknown as FormsDb);
        for (const bad of [
            null,
            'text',
            job({ formId: 42 }),
            job({ data: [VALID] }),
            job({ data: null }),
            job({ ipHash: 'x'.repeat(10_000) }),
            job({ recaptchaScore: 0.9 }),
            job({ recaptchaScore: 1000 }),
        ]) {
            const err = await rejection(AnswerValidatorService.validate(bad));
            expect(err).toBeInstanceOf(UnrecoverableError);
            expect(err.message).toBe('Malformed answer job');
        }
    });

    it('reads a form from Postgres once per cache period', async () => {
        const fake = db();
        AnswerValidatorService.setDb(fake as unknown as FormsDb);
        await AnswerValidatorService.validate(job());
        await AnswerValidatorService.validate(job());
        expect(fake.queries).toBe(1);

        Date.now = () => realNow() + 60_000;
        await AnswerValidatorService.validate(job());
        expect(fake.queries).toBe(2);
    });

    it('reads the form again before failing an answer the cached copy refuses', async () => {
        // A cached "scheduled" (or an older schema) must not cost the answers
        // sent in the seconds after the form opened (or changed).
        const rows = { 'opening-form': { status: 'scheduled', endsAt: null, validationSchema: SCHEMA } };
        const fake = fakeDb(rows);
        AnswerValidatorService.setDb(fake as unknown as FormsDb);
        await rejection(AnswerValidatorService.validate(job({ formId: 'opening-form' })));

        rows['opening-form'].status = 'open';
        expect(await AnswerValidatorService.validate(job({ formId: 'opening-form' }))).toBeDefined();
        expect(fake.queries).toBe(2);

        const withNickname = job({ formId: 'opening-form', data: { ...VALID, nickname: 'ada' } });
        await rejection(AnswerValidatorService.validate(withNickname));
        rows['opening-form'].validationSchema = generateJsonSchema([
            ...FIELDS,
            field({ fieldType: 'text', name: 'nickname' }),
        ] as any);
        expect(await AnswerValidatorService.validate(withNickname)).toBeDefined();
    });

    it('accepts exactly what forms-api accepts', async () => {
        AnswerValidatorService.setDb(db() as unknown as FormsDb);
        const samples = [
            VALID,
            { mail: 'ada@example.com', terms: true },
            { ...VALID, age: 99.5 },
            { ...VALID, age: '36' },
            { ...VALID, mail: 'a@b' },
            { ...VALID, extra: 1 },
            {},
        ];
        for (const data of samples) {
            const forms = SubmissionService.validateAnswer(SCHEMA, data).valid;
            const writer = await AnswerValidatorService.validate(job({ data })).then(
                () => true,
                () => false,
            );
            expect({ data, writer }).toEqual({ data, writer: forms });
        }
    });
});

describe('handleAnswerJob', () => {
    afterEach(() => {
        WriterService.stopFlushTimer();
        (WriterService as any).buffer = [];
    });

    it('stores a valid answer and never an invalid one', async () => {
        const db = fakeDb({ 'open-form': { status: 'open', endsAt: null, validationSchema: SCHEMA } });
        AnswerValidatorService.setDb(db as unknown as FormsDb);
        WriterService.setDb(db as unknown as FormsDb);

        const invalid = await rejection(handleAnswerJob(job({ data: { ...VALID, injected: 'x' } })));
        expect(invalid).toBeInstanceOf(UnrecoverableError);
        expect((WriterService as any).buffer).toHaveLength(0);

        const stored = handleAnswerJob(job());
        while ((WriterService as any).buffer.length === 0) await Bun.sleep(1);
        await WriterService.flush();
        await stored;
        expect(db.inserted).toHaveLength(1);
        expect(db.inserted[0]).toMatchObject({ formId: 'open-form', data: VALID, ipHash: IP_HASH, recaptchaScore: 90 });
    });
});
