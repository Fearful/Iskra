import { z } from 'zod';

export const AppConfigSchema = z.object({
    web: z.object({
        port: z.number().default(3000),
    }),
    db: z.object({
        // Ruta del archivo SQLite, o ':memory:' para una base efímera.
        url: z.string().default('cms.db'),
    }),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export const config: AppConfig = AppConfigSchema.parse({
    web: {
        port: Number(process.env.PORT) || 3000,
    },
    db: {
        url: process.env.DATABASE_URL || 'cms.db',
    },
});
