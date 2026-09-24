import { z } from 'zod';

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
        secret: process.env.RECAPTCHA_SECRET || 'your-secret-key',
        minScore: Number(process.env.RECAPTCHA_MIN_SCORE) || 0.5,
    },
    csrf: {
        secret: process.env.CSRF_SECRET || 'dev-csrf-secret',
    },
    ipHashSecret: process.env.IP_HASH_SECRET || process.env.CSRF_SECRET || 'dev-ip-hash-secret',
    staticDir: process.env.STATIC_DIR || '/app/static',
});
