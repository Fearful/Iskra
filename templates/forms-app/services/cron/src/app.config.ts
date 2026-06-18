import { z } from 'zod';

export const AppConfigSchema = z.object({
    web: z.object({
        port: z.number().default(4002),
    }),
    db: z.object({
        driver: z.literal('postgres').default('postgres'),
        url: z.string(),
    }),
    redis: z.object({
        url: z.string().default('redis://localhost:6379'),
    }),
    formManagerUrl: z.string().default('http://form-manager:4001'),
    checkIntervalMs: z.number().default(30_000),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export const config: AppConfig = AppConfigSchema.parse({
    web: { port: Number(process.env.PORT) || 4002 },
    db: {
        driver: 'postgres',
        url: process.env.DATABASE_URL || 'postgresql://forms:secret@localhost:5432/forms_app',
    },
    redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
    },
    formManagerUrl: process.env.FORM_MANAGER_URL || 'http://form-manager:4001',
    checkIntervalMs: Number(process.env.CHECK_INTERVAL_MS) || 30_000,
});
