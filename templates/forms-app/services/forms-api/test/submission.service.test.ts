import { createHash } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { SubmissionService } from '../src/domain/submission/submission.service.ts';
import { REDIS_KEYS, JOB_NAMES } from '@forms-app/shared';

// validateAnswer, hashIp and enqueueAnswer (with a fake worker) are pure → always run.
describe('SubmissionService.validateAnswer', () => {
    const schema = {
        type: 'object',
        properties: {
            name: { type: 'string', maxLength: 3, errorMessage: { maxLength: 'Too long' } },
            age: { type: 'number', minimum: 0, errorMessage: { minimum: 'Too small' } },
        },
        required: ['name'],
        additionalProperties: true,
    };

    it('accepts valid data', () => {
        expect(SubmissionService.validateAnswer(schema, { name: 'ok' })).toEqual({ valid: true, errors: {} });
    });

    it('reports a maxLength violation with the custom errorMessage', () => {
        const r = SubmissionService.validateAnswer(schema, { name: 'toolong' });
        expect(r.valid).toBe(false);
        expect(r.errors.name).toBe('Too long');
    });

    it('reports a minimum violation with the custom errorMessage', () => {
        const r = SubmissionService.validateAnswer(schema, { name: 'ok', age: -1 });
        expect(r.valid).toBe(false);
        expect(r.errors.age).toBe('Too small');
    });

    it('reports a missing required field', () => {
        const r = SubmissionService.validateAnswer(schema, {});
        expect(r.valid).toBe(false);
        expect(r.errors.name).toBeDefined();
    });

    // Regression: the schema-generator emits `format: "email" | "date"`. Without
    // ajv-formats, AJV's strict mode throws at compile time and crashes the whole
    // submission. These exercise the formats that real forms actually produce.
    it('validates the email format', () => {
        const emailSchema = {
            type: 'object',
            properties: { email: { type: 'string', format: 'email', errorMessage: { format: 'Bad email' } } },
            required: ['email'],
        };
        expect(SubmissionService.validateAnswer(emailSchema, { email: 'a@b.com' })).toEqual({
            valid: true,
            errors: {},
        });

        const r = SubmissionService.validateAnswer(emailSchema, { email: 'not-an-email' });
        expect(r.valid).toBe(false);
        expect(r.errors.email).toBe('Bad email');
    });

    it('validates the date format', () => {
        const dateSchema = {
            type: 'object',
            properties: { d: { type: 'string', format: 'date' } },
            required: ['d'],
        };
        expect(SubmissionService.validateAnswer(dateSchema, { d: '2026-05-23' }).valid).toBe(true);
        expect(SubmissionService.validateAnswer(dateSchema, { d: 'not-a-date' }).valid).toBe(false);
    });
});

describe('SubmissionService.hashIp', () => {
    it('is deterministic within a day and never exposes the raw ip', () => {
        const h1 = SubmissionService.hashIp('1.2.3.4', 'secret');
        const h2 = SubmissionService.hashIp('1.2.3.4', 'secret');
        expect(h1).toBe(h2);
        expect(h1).not.toContain('1.2.3.4');
        expect(h1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('produces different hashes for different ips', () => {
        expect(SubmissionService.hashIp('1.1.1.1', 'secret')).not.toBe(SubmissionService.hashIp('2.2.2.2', 'secret'));
    });

    it('is keyed: without the secret the hash cannot be recomputed from the ip and date', () => {
        const day = new Date().toISOString().slice(0, 10);
        const unkeyed = createHash('sha256').update(`1.2.3.4:${day}`).digest('hex');
        expect(SubmissionService.hashIp('1.2.3.4', 'secret')).not.toBe(unkeyed);
        expect(SubmissionService.hashIp('1.2.3.4', 'secret')).not.toBe(SubmissionService.hashIp('1.2.3.4', 'other'));
    });
});

describe('SubmissionService.getFormData', () => {
    it('keeps the same schema object while its JSON is unchanged (AJV caches validators per object)', async () => {
        const schemaJson = JSON.stringify({ type: 'object', properties: { a: { type: 'string' } } });
        const meta = JSON.stringify({ formId: 'f1', status: 'open' });
        const redis = { get: async (key: string) => (key.includes('schema') ? schemaJson : meta) };
        SubmissionService.setRedis(redis);
        const realNow = Date.now;
        try {
            const first = await SubmissionService.getFormData('reuse-space', 'reuse-form');
            // Past the 30 s cache TTL: the refresh reads Redis again.
            Date.now = () => realNow() + 60_000;
            const second = await SubmissionService.getFormData('reuse-space', 'reuse-form');
            expect(second!.schema).toBe(first!.schema);
        } finally {
            Date.now = realNow;
        }
    });
});

describe('SubmissionService.enqueueAnswer', () => {
    it('throws when no worker is configured', async () => {
        SubmissionService.setWorker(undefined);
        await expect(SubmissionService.enqueueAnswer('f', {}, 'h', 0.9)).rejects.toThrow('Worker not initialized');
    });

    it('enqueues an answer job with the recaptcha score scaled to an integer', async () => {
        const jobs: any[] = [];
        SubmissionService.setWorker({ enqueue: async (name: string, data: any) => jobs.push({ name, data }) });

        await SubmissionService.enqueueAnswer('form-1', { a: 1 }, 'iphash', 0.87);

        expect(jobs[0].name).toBe(JOB_NAMES.ANSWER_SUBMIT);
        expect(jobs[0].data).toEqual({ formId: 'form-1', data: { a: 1 }, ipHash: 'iphash', recaptchaScore: 87 });
    });
});

// getFormData reads from Redis (with a 30s in-memory cache) → gated.
const REDIS_URL = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';

async function redisReachable(): Promise<boolean> {
    const url = new URL(REDIS_URL);
    return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 1000);
        Bun.connect({
            hostname: url.hostname,
            port: Number(url.port) || 6379,
            socket: {
                data() {},
                open(s) {
                    clearTimeout(timer);
                    s.end();
                    resolve(true);
                },
                connectError() {
                    clearTimeout(timer);
                    resolve(false);
                },
            },
        }).catch(() => {
            clearTimeout(timer);
            resolve(false);
        });
    });
}

const redisUp = await redisReachable();

(redisUp ? describe : describe.skip)('SubmissionService.getFormData (requires Redis)', () => {
    let redis: any;

    beforeAll(async () => {
        const Redis = (await import('ioredis')).default;
        redis = new Redis(REDIS_URL);
        SubmissionService.setRedis(redis);
    });

    afterAll(async () => {
        await redis.quit();
    });

    it('reads schema and meta from Redis', async () => {
        const space = `s-${Date.now()}`;
        const form = 'f';
        await redis.set(REDIS_KEYS.formSchema(space, form), JSON.stringify({ type: 'object', properties: {} }));
        await redis.set(REDIS_KEYS.formMeta(space, form), JSON.stringify({ formId: 'fid', status: 'open' }));

        const result = await SubmissionService.getFormData(space, form);
        expect(result?.schema).toEqual({ type: 'object', properties: {} });
        expect(result?.meta.formId).toBe('fid');
    });

    it('serves a cached copy after the keys are removed (in-memory TTL cache)', async () => {
        const space = `cache-${Date.now()}`;
        const form = 'f';
        await redis.set(REDIS_KEYS.formSchema(space, form), JSON.stringify({ type: 'object' }));
        await redis.set(REDIS_KEYS.formMeta(space, form), JSON.stringify({ formId: 'cached', status: 'open' }));

        await SubmissionService.getFormData(space, form); // populates the cache
        await redis.del(REDIS_KEYS.formSchema(space, form), REDIS_KEYS.formMeta(space, form));

        const cached = await SubmissionService.getFormData(space, form);
        expect(cached?.meta.formId).toBe('cached');
    });

    it('returns null when the form is not in Redis', async () => {
        expect(await SubmissionService.getFormData('missing', 'missing')).toBeNull();
    });
});

describe('SubmissionService.validateAnswer with a generated schema', () => {
    it('reports custom required messages and rejects unknown fields', async () => {
        const { generateJsonSchema } = await import('../../admin-api/src/domain/forms/schema-generator.ts');
        const field = (o: Record<string, unknown>) => ({
            label: 'L',
            maxLength: null,
            min: null,
            max: null,
            options: null,
            errorMessage: null,
            ...o,
        });
        const schema = generateJsonSchema([
            field({ fieldType: 'email', name: 'mail', required: true, errorMessage: 'Pon tu correo' }),
            field({ fieldType: 'checkbox', name: 'terms', required: true }),
            field({ fieldType: 'number', name: 'age', required: false }),
        ] as any);
        // The custom message used to be ignored for a missing field.
        expect(SubmissionService.validateAnswer(schema, {}).errors.mail).toBe('Pon tu correo');
        expect(SubmissionService.validateAnswer(schema, { mail: 'a@b.co', terms: false }).valid).toBe(false);
        expect(
            SubmissionService.validateAnswer(schema, { mail: 'a@b.co', terms: true, extra: 'x' }).errors,
        ).toHaveProperty('extra');
        // An optional field left empty is omitted by the form, and passes.
        expect(SubmissionService.validateAnswer(schema, { mail: 'a@b.co', terms: true }).valid).toBe(true);
    });
});
