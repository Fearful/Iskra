import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import { Kernel } from '@iskra-bun/web-kit';
import router from '../src/interfaces/http/router.ts';
import { initDatabase } from '../src/db/setup.ts';
import { createApiKeyFeature, parseApiKeys } from '../src/auth.ts';

const ADMIN_KEY = 'admin-key-0123456789abcdef0123456789abcdef';
const ANA_KEY = 'ana-key-0123456789abcdef0123456789abcdef';
const BOB_KEY = 'bob-key-0123456789abcdef0123456789abcdef';

describe('ecommerce-api authentication', () => {
    let client: Database;
    let app: Hono;

    beforeAll(async () => {
        client = new Database(':memory:');
        initDatabase(drizzle(client));

        // Same wiring as src/main.ts (without the cache feature).
        const kernel = new Kernel({ logger: false });
        kernel.registerFeature(
            createApiKeyFeature(
                parseApiKeys(`admin-1:admin:${ADMIN_KEY},ana:customer:${ANA_KEY}, bob:customer:${BOB_KEY}`),
            ),
        );
        await kernel.initialize();
        const api = new Hono();
        api.route('/api', router);
        kernel.getApp().route('/', api);
        app = kernel.getApp();
    });

    afterAll(() => client.close());

    const call = (method: string, path: string, key?: string, body?: unknown) =>
        app.request(path, {
            method,
            headers: {
                ...(key ? { 'X-API-Key': key } : {}),
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });

    const widget = { name: 'Widget', price: 10, stock: 100 };

    it('keeps the catalog public and product writes for admins', async () => {
        expect((await call('GET', '/api/products')).status).toBe(200);
        // Anyone could create products with any price and stock.
        expect((await call('POST', '/api/products', undefined, widget)).status).toBe(401);
        expect((await call('POST', '/api/products', ANA_KEY, widget)).status).toBe(403);
        expect((await call('POST', '/api/products', ADMIN_KEY, widget)).status).toBe(201);
    });

    it('takes the order owner from the API key, never from the body', async () => {
        const product = await (await call('POST', '/api/products', ADMIN_KEY, widget)).json();
        const items = [{ productId: product.id, quantity: 1 }];

        expect((await call('POST', '/api/orders', undefined, { items })).status).toBe(401);
        const res = await call('POST', '/api/orders', ANA_KEY, { userId: 'bob', items });
        expect(res.status).toBe(201);
        expect((await res.json()).userId).toBe('ana');
    });

    it('shows each customer only their own orders, and admins all of them', async () => {
        const product = await (await call('POST', '/api/products', ADMIN_KEY, widget)).json();
        const items = [{ productId: product.id, quantity: 1 }];
        await call('POST', '/api/orders', BOB_KEY, { items });

        expect((await call('GET', '/api/orders')).status).toBe(401);
        const bobs = await (await call('GET', '/api/orders', BOB_KEY)).json();
        expect(bobs.length).toBeGreaterThan(0);
        expect(bobs.every((o: { userId: string }) => o.userId === 'bob')).toBe(true);

        const all = await (await call('GET', '/api/orders', ADMIN_KEY)).json();
        expect(new Set(all.map((o: { userId: string }) => o.userId))).toEqual(new Set(['ana', 'bob']));
    });

    it('caps the quantities of an order', async () => {
        const product = await (await call('POST', '/api/products', ADMIN_KEY, { ...widget, stock: 1000 })).json();
        const line = (quantity: number) => ({ productId: product.id, quantity });

        // One order used to be able to reserve the whole stock.
        expect((await call('POST', '/api/orders', ANA_KEY, { items: [line(500)] })).status).toBe(400);
        expect((await call('POST', '/api/orders', ANA_KEY, { items: [line(20), line(20), line(20)] })).status).toBe(
            400,
        );
        expect((await call('POST', '/api/orders', ANA_KEY, { items: [] })).status).toBe(400);
        expect((await call('POST', '/api/orders', ANA_KEY, { items: [line(20), line(20)] })).status).toBe(201);
    });
});

describe('API_KEYS', () => {
    it('parses <userId>:<role>:<key> entries', () => {
        expect(parseApiKeys(undefined)).toEqual([]);
        expect(parseApiKeys(`ana:customer:${ANA_KEY}`)).toEqual([{ userId: 'ana', role: 'customer', key: ANA_KEY }]);
    });

    it('rejects weak, malformed or repeated keys without echoing them', () => {
        for (const bad of [
            'ana:customer:short',
            `ana:root:${ANA_KEY}`,
            `ana:${ANA_KEY}`,
            `a b:customer:${ANA_KEY}`,
            `ana:customer:${ANA_KEY},bob:customer:${ANA_KEY}`,
            `ana:${ANA_KEY}:customer`,
        ]) {
            expect(() => parseApiKeys(bad)).toThrow();
            try {
                parseApiKeys(bad);
            } catch (err) {
                expect(String(err)).not.toContain(ANA_KEY);
            }
        }
    });
});
