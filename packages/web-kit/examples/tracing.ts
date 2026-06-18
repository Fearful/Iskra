/**
 * OpenTelemetry Tracing Example
 *
 * Demonstrates the recommended pattern:
 *   - App-level `otel` config initializes the NodeSDK (traces + metrics)
 *   - OtelTracingFeature adds HTTP request tracing middleware
 */
import { App } from '@iskra-bun/core';
import { WebPlugin } from '../src/driver';
import { OtelTracingFeature } from '../src/features/tracing';
import { ErrorHandlerFeature } from '../src/features/error-handler';
import { LoggerFeature } from '../src/features/logger';
import { Hono } from 'hono';

// ── Routes ──────────────────────────────────────────────────────────────────

const router = new Hono();

router.get('/', (c) =>
    c.json({
        message: 'OpenTelemetry Tracing Example',
        endpoints: ['GET /', 'GET /users'],
    }),
);

router.get('/users', async (c) => {
    // Simulate async work
    await new Promise((resolve) => setTimeout(resolve, 100));
    return c.json({
        users: [
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' },
        ],
    });
});

// ── App ─────────────────────────────────────────────────────────────────────

const app = new App({
    name: 'tracing-example',
    otel: {
        endpoint: 'http://localhost:4318',
        serviceVersion: '1.0.0',
    },
});

app.register(
    new WebPlugin({
        port: 8002,
        router,
        features: [
            new ErrorHandlerFeature(),
            new LoggerFeature({ level: 'info' }),
            new OtelTracingFeature({
                serviceName: 'tracing-example',
                serviceVersion: '1.0.0',
                captureRequestHeaders: ['user-agent', 'x-forwarded-for', 'content-type'],
                captureResponseHeaders: ['content-type', 'content-length'],
                spanNameFactory: (c) => `${c.req.method} ${c.req.path}`,
            }),
        ],
    }),
);

if (import.meta.main) {
    console.log('\nOpenTelemetry Tracing Example starting on port 8002');
    app.start();
}
