import { App } from '@iskra-bun/core';
import { WebPlugin, HealthCheckFeature } from '@iskra-bun/web-kit';
import { DbDriver } from '@iskra-bun/db-kit';
import { KVManager } from '@iskra-bun/kv-kit';
import { config } from './app.config.ts';
import router from './interfaces/http/router.ts';
import { PrerenderService } from './domain/prerender/prerender.service.ts';
import { LifecycleService } from './domain/lifecycle/lifecycle.service.ts';
import { Hono } from 'hono';

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

    const kvDriver = app.context.get('kv');

    PrerenderService.setDb(dbDriver.db);
    PrerenderService.setRedis(kvDriver?.client);

    LifecycleService.setDb(dbDriver.db);
    LifecycleService.setRedis(kvDriver?.client);

    console.log('Form Manager services initialized');
}

async function main() {
    await app.start();
    await setup();
    console.log(`Form Manager running on port ${config.web.port}`);
}

main().catch(console.error);
