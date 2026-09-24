import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { WebDriver } from '../src/server';
import { App } from '@iskra-bun/core';
import { z } from 'zod';

describe('WebDriver', () => {
    let app: App;
    let driver: WebDriver;
    const PORT = 3456;

    beforeAll(async () => {
        app = new App({ name: 'WebTest' });
        driver = new WebDriver({
            port: PORT,
            routes: [
                {
                    method: 'GET',
                    path: '/hello',
                    handler: () => ({ message: 'world' })
                },
                {
                    method: 'POST',
                    path: '/echo',
                    schema: {
                        body: z.object({ name: z.string() })
                    },
                    handler: (ctx) => ({ name: ctx.body.name })
                }
            ]
        });

        app.register(driver);
        await app.start();
    });

    afterAll(async () => {
        await app.stop();
    });

    it('should handle GET requests', async () => {
        const res = await fetch(`http://localhost:${PORT}/hello`);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toEqual({ message: 'world' });
    });

    it('should validation POST body', async () => {
        const res = await fetch(`http://localhost:${PORT}/echo`, {
            method: 'POST',
            body: JSON.stringify({ name: 'iskra' }),
            headers: { 'Content-Type': 'application/json' }
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toEqual({ name: 'iskra' });
    });

    it('should return 400 for invalid body', async () => {
        const res = await fetch(`http://localhost:${PORT}/echo`, {
            method: 'POST',
            body: JSON.stringify({ wrong: 'field' }),
            headers: { 'Content-Type': 'application/json' }
        });
        expect(res.status).toBe(400);
    });

    it('should serve OpenAPI documentation', async () => {
        // We didn't enable openApi in the beforeAll config. 
        // We need to create a separate instance or update beforeAll.
        // Let's create a separate instance for this test
        const app2 = new App({ name: 'DocApp' });
        const driver2 = new WebDriver({
            port: 3457, // different port
            openApi: {
                path: '/doc',
                title: 'Test API',
                version: '1.0.0'
            },
            routes: []
        });

        app2.register(driver2);
        await app2.start();

        const res = await fetch('http://localhost:3457/doc');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.info.title).toBe('Test API');
        expect(json.openapi).toBe('3.0.0');

        await app2.stop();
    });
});
