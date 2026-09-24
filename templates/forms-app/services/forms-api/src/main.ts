import { App } from '@iskra-bun/core';
import { WebPlugin, CsrfFeature, HealthCheckFeature, RateLimitFeature } from '@iskra-bun/web-kit';
import { KVManager } from '@iskra-bun/kv-kit';
import { WorkerManager } from '@iskra-bun/worker-kit';
import { config } from './app.config.ts';
import router from './interfaces/http/router.ts';
import { SubmissionService } from './domain/submission/submission.service.ts';
import { QUEUE_NAMES } from '@forms-app/shared';
import { Hono } from 'hono';

const app = new App({ name: 'FormsAPI' });

// NOTE: No DbDriver — this service is Redis-only for security
app.config.kv = {
    driver: 'redis',
    connection: config.redis.url,
};

const honoApp = new Hono();
honoApp.route('/', router);

const worker = new WorkerManager({
    connection: config.redis.url,
    queueName: QUEUE_NAMES.ANSWERS,
    // This service only enqueues, does not consume
    concurrency: 0,
});

app.register(new KVManager());
app.register(worker);
app.register(
    new WebPlugin({
        port: config.web.port,
        router: honoApp,
        features: [
            new HealthCheckFeature({ path: '/health' }),
            new CsrfFeature({ secret: config.csrf.secret }),
            new RateLimitFeature({
                max: 60,
                windowMs: 60_000,
            }),
        ],
    }),
);

async function setup() {
    const kvDriver = app.context.get('kv');

    SubmissionService.setRedis(kvDriver?.client);
    SubmissionService.setWorker(worker);

    console.log('Forms API services initialized');
}

async function main() {
    await app.start();
    await setup();
    console.log(`Forms API running on port ${config.web.port} (Redis-only, no Postgres)`);
}

main().catch(console.error);
