import { z } from 'zod';

export const AppConfigSchema = z.object({
    name: z.string().default('IskraApp'),
    debug: z.boolean().default(false),
    logger: z.object({
        level: z.string().default('info')
    }).default({}),
    otel: z.object({
        enabled: z.boolean().default(true),
        endpoint: z.string().default('http://localhost:4318'),
        serviceName: z.string().optional(),
        serviceVersion: z.string().default('0.1.0'),
        environment: z.string().optional(),
        metricIntervalMs: z.number().default(60_000),
        resourceAttributes: z.record(z.string()).optional(),
        instrumentations: z.record(z.object({ enabled: z.boolean().optional() })).optional(),
    }).optional(),
    processes: z.record(z.object({
        command: z.string(),
        args: z.array(z.string()).optional(),
        mode: z.enum(['daemon', 'oneshot', 'stdio']).default('daemon'),
        restartOnCrash: z.boolean().default(false),
        env: z.record(z.string()).optional()
    })).optional()
});

export type AppConfigInput = z.input<typeof AppConfigSchema>;
export type AppConfigOutput = z.output<typeof AppConfigSchema>;
