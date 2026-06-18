import { z } from 'zod';

export const AppConfigSchema = z.object({
    web: z.object({
        port: z.number().default(4000),
    }),
    db: z.object({
        driver: z.literal('postgres').default('postgres'),
        url: z.string(),
    }),
    auth: z.object({
        secret: z.string(),
        baseURL: z.string().default('http://localhost:4000'),
    }),
    cors: z.object({
        origins: z.string().default('http://localhost'),
    }),
    formManagerUrl: z.string().default('http://form-manager:4001'),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export const config: AppConfig = AppConfigSchema.parse({
    web: {
        port: Number(process.env.PORT) || 4000,
    },
    db: {
        driver: 'postgres',
        url: process.env.DATABASE_URL || 'postgresql://forms:secret@localhost:5432/forms_app',
    },
    auth: {
        secret: process.env.AUTH_SECRET || 'dev-secret-change-me',
        baseURL: process.env.AUTH_BASE_URL || 'http://localhost:4000',
    },
    cors: {
        origins: process.env.CORS_ORIGINS || 'http://localhost',
    },
    formManagerUrl: process.env.FORM_MANAGER_URL || 'http://form-manager:4001',
});
