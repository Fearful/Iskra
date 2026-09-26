import { App } from '@iskra-bun/core';
import { WebPlugin, HealthCheckFeature } from '@iskra-bun/web-kit';
import { DbDriver } from '@iskra-bun/db-kit';
import { KVManager } from '@iskra-bun/kv-kit';
import { config } from './app.config.ts';
import { SchedulerService } from './domain/scheduler.service.ts';
import { RedisPopulatorService } from './domain/redis-populator.service.ts';
import { Hono } from 'hono';
import { asFormsDb } from '@forms-app/shared/db/client';

const app = new App({ name: 'Cron' });

app.config.db = config.db;
app.config.kv = {
    driver: 'redis',
    connection: config.redis.url,
};

const honoApp = new Hono();

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
    SchedulerService.setDb(db);
    RedisPopulatorService.setDb(db);
    RedisPopulatorService.setRedis(redis);
}

async function main() {
    await app.start();
    await setup();

    // Initial Redis population
    await RedisPopulatorService.populateActiveForms();

    // Start the scheduler loop
    console.log(`Cron running, checking every ${config.checkIntervalMs}ms`);

    setInterval(async () => {
        try {
            await SchedulerService.runCycle();
        } catch (err) {
            console.error('Scheduler cycle error:', err);
        }
    }, config.checkIntervalMs);

    // Re-populate Redis every 5 minutes
    setInterval(
        async () => {
            try {
                await RedisPopulatorService.populateActiveForms();
            } catch (err) {
                console.error('Redis population error:', err);
            }
        },
        5 * 60 * 1000,
    );

    console.log(`Cron service running on port ${config.web.port}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
