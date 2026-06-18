import { Hono } from 'hono';
import { snapshot } from '../metrics.ts';
import { config } from '../app.config.ts';

/**
 * Router de health/monitoring del worker.
 *
 * Se monta con `WebPlugin` (ver main.ts). Expone:
 *  - GET /health   → liveness simple (para Docker/K8s)
 *  - GET /metrics  → contadores en memoria de esta instancia
 *
 * Las metricas son por-instancia. En un despliegue con varias replicas,
 * cada una reporta lo suyo; la verdad agregada vive en Redis.
 */
export function createMonitoringRouter(): Hono {
    const router = new Hono();

    router.get('/health', (c) => {
        return c.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    router.get('/metrics', (c) => {
        return c.json({
            worker: {
                queue: config.worker.queueName,
                concurrency: config.worker.concurrency,
            },
            dlq: {
                queue: config.dlq.queueName,
            },
            counters: snapshot(),
        });
    });

    return router;
}
