import { App } from '@iskra-bun/core';
import { WebPlugin, CsrfFeature, HealthCheckFeature, RateLimitFeature, type CsrfConfig } from '@iskra-bun/web-kit';
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

// A variable, not a literal: `trustedOrigins` is only in the CsrfConfig of
// web-kit versions whose CsrfFeature checks the Origin (earlier ones ignore it).
const csrf: CsrfConfig & { trustedOrigins?: string[] } = config.csrf;

const worker = new WorkerManager({
    connection: config.redis.url,
    queueName: QUEUE_NAMES.ANSWERS,
    // Only enqueues: answer-writer consumes. (concurrency: 0 used to mean 1,
    // so this service took answer jobs it had no handler for and lost them.)
    consume: false,
});

app.register(new KVManager());
app.register(worker);
app.register(
    new WebPlugin({
        port: config.web.port,
        trustProxy: config.web.trustProxy,
        router: honoApp,
        features: [
            new HealthCheckFeature({ path: '/health' }),
            new CsrfFeature(csrf),
            new RateLimitFeature({
                max: 60,
                windowMs: 60_000,
            }),
        ],
    }),
);

async function setup() {
    // KVManager's ioredis client: without it these services cannot read or
    // write the form keys, so fail instead of running without Redis.
    const redis = app.context.get('kv')?.client;
    if (!redis) throw new Error('Redis client not available (KVManager with the redis driver)');

    SubmissionService.setRedis(redis);
    SubmissionService.setWorker(worker);

    console.log('Forms API services initialized');
}

async function main() {
    await app.start();
    await setup();
    console.log(`Forms API running on port ${config.web.port} (Redis-only, no Postgres)`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
