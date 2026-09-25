import { describe, it, expect, afterAll } from 'bun:test';
import { App } from '@iskra-bun/core';
import { WebPlugin } from '@iskra-bun/web-kit';
import { DbDriver } from '@iskra-bun/db-kit';
import productRouter from '../src/interfaces/http/router.ts';
import { setupDatabase } from '../src/db/setup.ts';
import { Hono } from 'hono';

const TEST_PORT = 3321;

describe('Ecommerce API App', () => {
    let app: App;

    it('should start and serve requests', async () => {
        app = new App({
            name: 'EcommerceAPITest',
            logger: { level: 'error' },
            db: { driver: 'sqlite', url: ':memory:' },
        });

        const router = new Hono();
        router.route('/api', productRouter);

        app.register(new DbDriver());
        app.register(
            new WebPlugin({
                port: TEST_PORT,
                router: router,
            }),
        );

        await app.start();

        // Set up DB tables and inject into services
        setupDatabase(app);

        const response = await fetch(`http://localhost:${TEST_PORT}/api/products`);
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(Array.isArray(data)).toBe(true);
    });

    afterAll(async () => {
        if (app) await app.stop();
    });
});
