import { App } from '@iskra-bun/core';
import { WebPlugin, CacheFeature } from '@iskra-bun/web-kit';
import { DbDriver } from '@iskra-bun/db-kit';
import { config } from './app.config.ts';
import productRouter from './interfaces/http/router.ts';
import { setupDatabase } from './db/setup.ts';
import { createApiKeyFeature, parseApiKeys } from './auth.ts';
import { Hono } from 'hono';

// API keys de los usuarios (ver src/auth.ts). Una entrada invalida corta el arranque.
const apiKeys = parseApiKeys(process.env.API_KEYS);
if (apiKeys.length === 0) {
    console.warn(
        '[ecommerce-api] API_KEYS está vacío: el catálogo es público, pero crear productos u órdenes responde 401.',
    );
}

const app = new App({ name: 'EcommerceAPI' });

// Add DB Config to App (since accessing config via imports in main, need to sync with App's internal config if it uses it)
// App.ts ctor: this.config = ...
// If we pass config to App ctor it overrides.
// But App ctor expects AppConfig which is generic in core types, but we extended it?
// Let's pass the config object.
// core/types.ts defines AppConfig.
// We should probably merge our local config with what App expects.
// For now, let's manually attach `db` config to `app.config` if `App` doesn't take it fully or if `AppConfig` interface in core is loose.
// `App` class in `core/src/app.ts` has `public config: AppConfig`.
// `AppConfig` in `core/src/types.ts` likely has `db?: any`.
// Let's cast or assign.
app.config.db = config.db;
app.config.cache = config.cache;

const router = new Hono();
router.route('/api', productRouter);

app.register(new DbDriver());
app.register(
    new WebPlugin({
        port: config.web.port,
        router: router,
        features: [new CacheFeature(config.cache), createApiKeyFeature(apiKeys)],
    }),
);

async function setupDb() {
    setupDatabase(app);
    console.log('✅ Database tables created');
}

async function main() {
    await app.start();
    await setupDb();
    console.log(`Server is running on port ${config.web.port}`);
}

// Exit 1 on a failed start (e.g. the database is unreachable): with only
// console.error the process exited 0, which restart policies read as success.
main().catch((err) => {
    console.error('Could not start E-commerce API:', err);
    process.exit(1);
});
