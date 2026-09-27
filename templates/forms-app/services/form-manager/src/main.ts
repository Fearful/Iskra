import { App } from '@iskra-bun/core';
import { WebPlugin, HealthCheckFeature } from '@iskra-bun/web-kit';
import { DbDriver } from '@iskra-bun/db-kit';
import { KVManager } from '@iskra-bun/kv-kit';
import { config } from './app.config.ts';
import router from './interfaces/http/router.ts';
import { PrerenderService } from './domain/prerender/prerender.service.ts';
import { LifecycleService } from './domain/lifecycle/lifecycle.service.ts';
import { Hono } from 'hono';
import { asFormsDb } from '@forms-app/shared/db/client';

const app = new App({ name: 'FormManager' });

app.config.db = config.db;
app.config.kv = {
    driver: 'redis',
    connection: config.redis.url,
};

const honoApp = new Hono();
honoApp.route('/', router);

app.register(new DbDriver());
app.register(new KVManager());
app.register(
    new WebPlugin({
        port: config.web.port,
        router: honoApp,
        features: [new HealthCheckFeature({ path: '/health' })],
    }),
);

async function setup() {
    const dbDriver = app.context.get('db');
    if (!dbDriver?.db) {
        console.error('DB Driver not initialized');
        return;
    }

    // KVManager's ioredis client: without it these services cannot read or
    // write the form keys, so fail instead of running without Redis.
    const redis = app.context.get('kv')?.client;
    if (!redis) throw new Error('Redis client not available (KVManager with the redis driver)');

    const db = asFormsDb(dbDriver.db);
    PrerenderService.setDb(db);
    PrerenderService.setRedis(redis);

    LifecycleService.setDb(db);
    LifecycleService.setRedis(redis);

    console.log('Form Manager services initialized');
}

async function main() {
    await app.start();
    await setup();
    console.log(`Form Manager running on port ${config.web.port}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
