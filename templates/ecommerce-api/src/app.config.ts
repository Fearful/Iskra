import { z } from 'zod';

export const AppConfigSchema = z.object({
    web: z.object({
        port: z.number().default(3000),
        cors: z.boolean().default(true),
    }),
    db: z.object({
        driver: z.enum(['sqlite', 'postgres', 'mysql', 'libsql']).default('sqlite'),
        url: z.string().default('ecommerce.db'),
    }),
    cache: z
        .object({
            adapter: z.enum(['memory', 'redis']).default('memory'),
            ttl: z.number().default(60),
        })
        .optional(),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export const config: AppConfig = {
    web: {
        port: Number(process.env.PORT) || 3000,
        cors: true,
    },
    db: {
        driver: 'sqlite',
        url: process.env.DATABASE_URL || 'ecommerce.db',
    },
    cache: {
        adapter: 'memory',
        ttl: 60,
    },
};
