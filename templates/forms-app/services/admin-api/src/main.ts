import { App } from '@iskra-bun/core';
import { WebPlugin, CorsFeature, HealthFeature, AuthFeature } from '@iskra-bun/web-kit';
import { DbDriver } from '@iskra-bun/db-kit';
import { config } from './app.config.ts';
import router from './interfaces/http/router.ts';
import { SpaceService } from './domain/spaces/space.service.ts';
import { FormService } from './domain/forms/form.service.ts';
import { Hono } from 'hono';

const app = new App({ name: 'AdminAPI' });

app.config.db = config.db;

const honoApp = new Hono();
honoApp.route('/api', router);

app.register(new DbDriver());
app.register(
    new WebPlugin({
        port: config.web.port,
        router: honoApp,
        features: [
            new CorsFeature({
                origin: config.cors.origins.split(','),
                credentials: true,
            }),
            new HealthFeature({ path: '/health' }),
            new AuthFeature({
                secret: config.auth.secret,
                baseURL: config.auth.baseURL,
            }),
        ],
    }),
);

async function setupDb() {
    const dbDriver = app.context.get('db');
    if (!dbDriver?.db) {
        console.error('DB Driver not initialized');
        return;
    }

    SpaceService.setDb(dbDriver.db);
    FormService.setDb(dbDriver.db);

    console.log('Database services initialized');
}

async function main() {
    await app.start();
    await setupDb();
    console.log(`Admin API running on port ${config.web.port}`);
}

main().catch(console.error);
