import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { App } from '@iskra-bun/core';
import { WebDriver } from '@iskra-bun/web-kit';
import { DbDriver } from '@iskra-bun/db-kit';
import { UserService } from '../src/domain/user.service';
import { users } from '../src/db/schema';
import { createRouter } from '../src/interfaces/http/router';

function freePort(): number {
    const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
    const port = probe.port!;
    probe.stop(true);
    return port;
}

describe('db-starter /users', () => {
    let app: App;
    let base: string;

    beforeAll(async () => {
        const port = freePort();
        base = `http://127.0.0.1:${port}`;
        // Same wiring as src/main.ts, on an in-memory database.
        app = new App({
            name: 'DbStarterTest',
            logger: { level: 'error' },
            db: { driver: 'sqlite', url: ':memory:' },
            shutdownSignals: false,
        });
        const db = new DbDriver<{ users: typeof users }>();
        const userService = new UserService(db);
        app.register(new WebDriver({ port, routes: createRouter(userService) }));
        app.register(db);
        await app.start();
        await userService.initTable();
    });

    afterAll(async () => {
        await app?.stop();
    });

    const create = (body: unknown) =>
        fetch(`${base}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

    it('creates a user (every POST used to fail with 500)', async () => {
        const res = await create({ name: 'Ana', email: 'Ana@Example.com' });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ created: { name: 'Ana', email: 'ana@example.com' } });
        expect((await create({ name: 'Otra Ana', email: 'ana@example.com' })).status).toBe(409);
    });

    it('validates and bounds the body', async () => {
        for (const body of [
            {},
            { name: 'Bob' },
            { name: 'Bob', email: 'no-es-un-email' },
            { name: 'x'.repeat(101), email: 'b@example.com' },
        ]) {
            expect((await create(body)).status).toBe(400);
        }
    });

    it('lists users without their emails', async () => {
        const listed = await (await fetch(`${base}/users`)).json();
        expect(listed.users.length).toBeGreaterThan(0);
        expect(JSON.stringify(listed)).not.toContain('@');
        expect(listed.users[0]).toEqual({ id: expect.any(Number), name: 'Ana' });
    });
});
