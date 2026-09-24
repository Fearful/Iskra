import { App } from '@iskra-bun/core';
import { WebPlugin, CorsFeature, HealthCheckFeature, AuthFeature, DbFeature } from '@iskra-bun/web-kit';
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
        // Behind nginx: the auth rate limit is per client, not per proxy.
        trustProxy: Number(process.env.TRUST_PROXY ?? 1),
        router: honoApp,
        features: [
            new CorsFeature({
                origin: config.cors.origins.split(','),
                credentials: true,
            }),
            new HealthCheckFeature({ path: '/health' }),
            // AuthFeature stores users/sessions through the web-kit DbFeature.
            new DbFeature({ adapter: 'postgres', connection: { connectionString: config.db.url } }),
            new AuthFeature({
                secret: config.auth.secret,
                baseURL: config.auth.baseURL,
                basePath: config.auth.basePath,
                trustedOrigins: config.cors.origins.split(','),
                // Admin accounts are created with `bun run create-admin`, never
                // through a public sign-up endpoint.
                enableSelfRegistration: false,
            }),
        ],
    }),
);

async function setupDb() {
    const dbDriver = app.context.get('db');
    // Fail the start instead of serving every request without a database.
    if (!dbDriver?.db) {
        throw new Error('DB Driver not initialized');
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

// Exit 1 on a failed start (e.g. the database is unreachable): with only
// console.error the process exited 0, which restart policies read as success.
main().catch((err) => {
    console.error('Could not start Admin API:', err);
    process.exit(1);
});
