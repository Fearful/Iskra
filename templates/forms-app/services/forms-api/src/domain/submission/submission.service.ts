import Ajv from 'ajv';
import ajvErrors from 'ajv-errors';
import addFormats from 'ajv-formats';
import { REDIS_KEYS, FormStatus, QUEUE_NAMES, JOB_NAMES } from '@forms-app/shared';
import type { FormMeta } from '@forms-app/shared';
import { createHmac } from 'crypto';

// addFormats registers the standard string formats (email, date, uri, ...).
// Without it, AJV's strict mode throws on `format` keywords, so any form with an
// email or date field would crash server-side validation.
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
ajvErrors(ajv);

// In-memory cache for form schemas (TTL-based)
const schemaCache = new Map<string, { schema: any; schemaJson: string; meta: FormMeta; cachedAt: number }>();
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

        // The same schema object while its JSON is unchanged: AJV caches the
        // compiled validator per schema object, so a new object on every
        // refresh compiled (and kept) another validator every 30 s.
        const schema = cached?.schemaJson === schemaJson ? cached.schema : JSON.parse(schemaJson);
        if (cached && cached.schema !== schema) ajv.removeSchema(cached.schema);
        const meta: FormMeta = JSON.parse(metaJson);

        schemaCache.set(cacheKey, { schema, schemaJson, meta, cachedAt: Date.now() });

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
            // "/tags/0" → "tags"; a missing field is reported on the object,
            // directly or (with a custom message) through ajv-errors.
            const field =
                err.instancePath?.split('/')[1] ||
                err.params?.missingProperty ||
                err.params?.errors?.[0]?.params?.missingProperty ||
                (err.keyword === 'additionalProperties' ? err.params?.additionalProperty : undefined);
            if (field && !errors[field]) {
                errors[field] = err.message ?? 'Invalid value';
            }
        }

        return { valid: false, errors };
    }

    /**
     * Daily pseudonymous IP id. Keyed with a secret: a plain hash of the IP
     * and the date could be reversed by hashing every IPv4 address.
     */
    static hashIp(ip: string, secret: string): string {
        const day = new Date().toISOString().slice(0, 10);
        return createHmac('sha256', secret).update(`${ip}:${day}`).digest('hex');
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
