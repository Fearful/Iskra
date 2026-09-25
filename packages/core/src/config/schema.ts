import { z } from 'zod';

const RestartBackoffSchema = z.object({
    initialMs: z.number().positive().optional(),
    maxMs: z.number().positive().optional(),
    factor: z.number().positive().optional(),
});

// Sections owned by the kits are validated here for shape only, and every
// object is `.passthrough()`: AppConfig promises `[key: string]: any`, and a
// plain z.object() silently strips unknown keys — which used to drop `db`,
// `kv` and `socket` from app.config.ts entirely.
export const AppConfigSchema = z
    .object({
        name: z.string().default('IskraApp'),
        debug: z.boolean().default(false),
        logger: z
            .object({
                level: z.string().default('info'),
            })
            .passthrough()
            .default({}),
        otel: z
            .object({
                enabled: z.boolean().default(true),
                endpoint: z.string().default('http://localhost:4318'),
                serviceName: z.string().optional(),
                serviceVersion: z.string().default('0.1.0'),
                environment: z.string().optional(),
                metricIntervalMs: z.number().default(60_000),
                resourceAttributes: z.record(z.string()).optional(),
                instrumentations: z.record(z.object({ enabled: z.boolean().optional() })).optional(),
            })
            .passthrough()
            .optional(),
        shutdownSignals: z.union([z.array(z.string()), z.literal(false)]).optional(),
        shutdownTimeoutMs: z.number().positive().optional(),
        processes: z
            .record(
                z
                    .object({
                        command: z.string(),
                        args: z.array(z.string()).optional(),
                        mode: z.enum(['daemon', 'oneshot', 'stdio']).default('daemon'),
                        restartOnCrash: z.boolean().default(false),
                        maxRestarts: z.number().int().nonnegative().optional(),
                        restartCooldown: z.number().nonnegative().optional(),
                        restartBackoff: RestartBackoffSchema.optional(),
                        env: z.record(z.string()).optional(),
                    })
                    .passthrough(),
            )
            .optional(),
        socket: z
            .object({
                enabled: z.boolean(),
                port: z.number().optional(),
                adapter: z.enum(['bun', 'socket.io']).optional(),
            })
            .passthrough()
            .optional(),
        kv: z
            .object({
                driver: z.enum(['memory', 'redis']),
                connection: z.any().optional(),
            })
            .passthrough()
            .optional(),
        db: z
            .object({
                driver: z.enum(['postgres', 'mysql', 'sqlite', 'libsql']),
                url: z.string(),
                authToken: z.string().optional(),
            })
            .passthrough()
            .optional(),
    })
    .passthrough();

export type AppConfigInput = z.input<typeof AppConfigSchema>;
export type AppConfigOutput = z.output<typeof AppConfigSchema>;
