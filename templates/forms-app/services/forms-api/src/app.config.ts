import { z } from 'zod';

export const AppConfigSchema = z.object({
    web: z.object({
        port: z.number().default(3000),
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
    staticDir: z.string().default('/app/static'),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export const config: AppConfig = AppConfigSchema.parse({
    web: { port: Number(process.env.PORT) || 3000 },
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
    staticDir: process.env.STATIC_DIR || '/app/static',
});
