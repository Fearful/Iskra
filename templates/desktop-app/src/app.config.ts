import { z } from 'zod';

export const AppConfigSchema = z.object({
    app: z.object({
        name: z.string().default('My Desktop App'),
        version: z.string().default('0.1.0'),
    }),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export const config: AppConfig = AppConfigSchema.parse({
    app: {
        name: process.env.APP_NAME || 'Iskra Desktop App',
        version: process.env.APP_VERSION || '0.1.0',
    },
});
