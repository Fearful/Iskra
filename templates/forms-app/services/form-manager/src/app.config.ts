import { z } from 'zod';
import { internalApiToken } from '@forms-app/shared/internal-api';

export const AppConfigSchema = z.object({
    web: z.object({
        port: z.number().default(4001),
    }),
    db: z.object({
        driver: z.literal('postgres').default('postgres'),
        url: z.string(),
    }),
    redis: z.object({
        url: z.string().default('redis://localhost:6379'),
    }),
    staticDir: z.string().default('/app/static'),
    /** Required on every /internal request (INTERNAL_API_TOKEN). */
    internalApiToken: z.string(),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export const config: AppConfig = AppConfigSchema.parse({
    web: { port: Number(process.env.PORT) || 4001 },
    db: {
        driver: 'postgres',
        url: process.env.DATABASE_URL || 'postgresql://forms:secret@localhost:5432/forms_app',
    },
    redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
    },
    staticDir: process.env.STATIC_DIR || '/app/static',
    internalApiToken: internalApiToken(),
});
