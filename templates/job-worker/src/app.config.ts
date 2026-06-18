import { z } from 'zod';

export const AppConfigSchema = z.object({
    worker: z.object({
        /** Cantidad de jobs procesados en paralelo */
        concurrency: z.number().int().positive().default(2),
        /** Nombre de la queue principal */
        queueName: z.string().default('iskra-jobs'),
    }),
    retry: z.object({
        /** Intentos totales antes de mandar el job a la dead-letter queue */
        attempts: z.number().int().positive().default(3),
        /** Tipo de backoff entre reintentos */
        backoffType: z.enum(['fixed', 'exponential']).default('exponential'),
        /** Delay base del backoff en ms */
        backoffDelay: z.number().int().positive().default(1000),
    }),
    dlq: z.object({
        /** Nombre de la dead-letter queue donde caen los jobs agotados */
        queueName: z.string().default('iskra-jobs-dlq'),
    }),
    http: z.object({
        /** Puerto del endpoint de health/monitoring */
        port: z.number().int().positive().default(8080),
    }),
    redis: z.object({
        url: z.string().default('redis://localhost:6379'),
    }),
    /** Si es true, encola jobs de demostracion periodicamente */
    demo: z.boolean().default(true),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export const config: AppConfig = AppConfigSchema.parse({
    worker: {
        concurrency: process.env.CONCURRENCY ? Number(process.env.CONCURRENCY) : undefined,
        queueName: process.env.QUEUE_NAME,
    },
    retry: {
        attempts: process.env.RETRY_ATTEMPTS ? Number(process.env.RETRY_ATTEMPTS) : undefined,
        backoffType: process.env.BACKOFF_TYPE as 'fixed' | 'exponential' | undefined,
        backoffDelay: process.env.BACKOFF_DELAY ? Number(process.env.BACKOFF_DELAY) : undefined,
    },
    dlq: {
        queueName: process.env.DLQ_NAME,
    },
    http: {
        port: process.env.HTTP_PORT ? Number(process.env.HTTP_PORT) : undefined,
    },
    redis: {
        url: process.env.REDIS_URL,
    },
    demo: process.env.DEMO ? process.env.DEMO !== 'false' : undefined,
});
