import { App } from '@iskra-bun/core';
import { WebPlugin, CacheFeature } from '@iskra-bun/web-kit';
import { DbDriver } from '@iskra-bun/db-kit';
import { config } from './app.config.ts';
import productRouter from './interfaces/http/router.ts';
import { ProductService } from './domain/products/product.service.ts';
import { OrderService } from './domain/orders/order.service.ts';
import { Hono } from 'hono';

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
app.register(new WebPlugin({
    port: config.web.port,
    router: router,
    features: [
        new CacheFeature(config.cache)
    ]
}));

async function setupDb() {
    const dbDriver = app.context.get('db');
    // Fail the start instead of serving every request without a database.
    if (!dbDriver || !dbDriver.client) {
        throw new Error('DB Driver not initialized');
    }

    // SQLite specific table creation
    const client = dbDriver.client;
    client.exec(`
        CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            price REAL NOT NULL,
            stock INTEGER NOT NULL,
            created_at INTEGER DEFAULT (unixepoch()),
            updated_at INTEGER DEFAULT (unixepoch())
        );
        CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            total REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at INTEGER DEFAULT (unixepoch())
        );
        CREATE TABLE IF NOT EXISTS order_items (
            id TEXT PRIMARY KEY,
            order_id TEXT NOT NULL,
            product_id TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            price REAL NOT NULL,
            FOREIGN KEY(order_id) REFERENCES orders(id),
            FOREIGN KEY(product_id) REFERENCES products(id)
        );
    `);
    // Inject DB into services
    ProductService.setDb(dbDriver.db);
    OrderService.setDb(dbDriver.db);

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
