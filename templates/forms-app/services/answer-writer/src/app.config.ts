import { z } from 'zod';
import { secretFromEnv } from '@forms-app/shared/env';

export const AppConfigSchema = z.object({
    db: z.object({
        driver: z.literal('postgres').default('postgres'),
        url: z.string(),
    }),
    redis: z.object({
        url: z.string().default('redis://localhost:6379'),
    }),
    worker: z.object({
        // Jobs wait for their answer to be stored, so this is also the
        // largest batch: keep it at least batch.maxSize.
        concurrency: z.number().default(50),
    }),
    batch: z.object({
        maxSize: z.number().default(50),
        flushIntervalMs: z.number().default(2000),
    }),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export const config: AppConfig = AppConfigSchema.parse({
    db: {
        driver: 'postgres',
        url: secretFromEnv('DATABASE_URL', 'postgresql://forms:secret@localhost:5432/forms_app', { minLength: 1 }),
    },
    redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
    },
    worker: {
        concurrency: Number(process.env.WORKER_CONCURRENCY) || 50,
    },
    batch: {
        maxSize: Number(process.env.BATCH_MAX_SIZE) || 50,
        flushIntervalMs: Number(process.env.BATCH_FLUSH_INTERVAL_MS) || 2000,
    },
});
