import { z } from 'zod';
import { secretFromEnv } from '@forms-app/shared/env';

export const AppConfigSchema = z.object({
    web: z.object({
        port: z.number().default(3000),
        // Proxies in front of the service (nginx in docker-compose): the
        // client IP is read from X-Forwarded-For that many hops from the end.
        // Without it every visitor had nginx's IP and shared one rate limit.
        trustProxy: z.number().int().min(0).default(1),
    }),
    redis: z.object({
        url: z.string().default('redis://localhost:6379'),
    }),
    recaptcha: z.object({
        secret: z.string(),
        minScore: z.number().default(0.5),
        /** Hostnames a token may come from (RECAPTCHA_HOSTNAMES); empty: any. */
        hostnames: z.array(z.string()).default([]),
    }),
    csrf: z.object({
        secret: z.string(),
    }),
    /** Keys the daily IP hash, so it cannot be reversed by hashing every IPv4 address. */
    ipHashSecret: z.string(),
    staticDir: z.string().default('/app/static'),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export const config: AppConfig = AppConfigSchema.parse({
    web: {
        port: Number(process.env.PORT) || 3000,
        trustProxy: process.env.TRUST_PROXY !== undefined ? Number(process.env.TRUST_PROXY) : 1,
    },
    redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
    },
    recaptcha: {
        // Issued by Google (https://www.google.com/recaptcha/admin), not generated.
        secret: secretFromEnv('RECAPTCHA_SECRET', 'your-secret-key', { minLength: 1 }),
        minScore: Number(process.env.RECAPTCHA_MIN_SCORE) || 0.5,
        hostnames: (process.env.RECAPTCHA_HOSTNAMES ?? '')
            .split(',')
            .map((h) => h.trim().toLowerCase())
            .filter(Boolean),
    },
    csrf: {
        secret: secretFromEnv('CSRF_SECRET', 'dev-csrf-secret-change-me-32-characters'),
    },
    // A key of its own: it used to fall back to CSRF_SECRET, so the stored IP
    // hashes and the CSRF token signatures came from the same key.
    ipHashSecret: secretFromEnv('IP_HASH_SECRET', 'dev-ip-hash-secret-change-me-32-chars'),
    staticDir: process.env.STATIC_DIR || '/app/static',
});
