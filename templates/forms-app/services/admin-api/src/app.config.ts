import { z } from 'zod';
import { secretFromEnv } from '@forms-app/shared/env';

// The documented dev flow serves the admin SPA from Vite on :5173, whose proxy
// forwards the browser's Origin unchanged: better-auth rejected every sign-in
// from it with 403 INVALID_ORIGIN. Production (and compose) use nginx's origin.
const DEFAULT_ORIGINS =
    process.env.NODE_ENV === 'production' ? 'http://localhost' : 'http://localhost,http://localhost:5173';

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
        basePath: z.string().default('/api/auth'),
    }),
    cors: z.object({
        origins: z.string().default(DEFAULT_ORIGINS),
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
        // Signs the session cookies: with better-auth's cookie cache, whoever
        // knows it can make one for any admin, with no session in the database.
        secret: secretFromEnv('AUTH_SECRET', 'dev-secret-change-me-min-32-characters-long'),
        baseURL: process.env.AUTH_BASE_URL || 'http://localhost:4000',
        basePath: '/api/auth',
    },
    cors: {
        origins: process.env.CORS_ORIGINS || DEFAULT_ORIGINS,
    },
    formManagerUrl: process.env.FORM_MANAGER_URL || 'http://form-manager:4001',
});
