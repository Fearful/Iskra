import { describe, expect, it } from 'bun:test';
import { Kernel } from '../src/kernel';
import { SessionFeature } from '../src/features/session';
import { CacheFeature, type CacheAdapter } from '../src/features/cache';
import type { Feature } from '../src/types';

/** A cache whose writes take a while to reach the store, like Redis over a network. */
class SlowWritesCache implements CacheAdapter {
    private map = new Map<string, unknown>();
    /** Runs (once) while the next write is on its way. */
    whileWriting?: () => Promise<unknown>;

    private async travel() {
        const run = this.whileWriting;
        this.whileWriting = undefined;
        await run?.();
    }

    async get(key: string) {
        return this.map.get(key) ?? null;
    }
    async set(key: string, value: unknown) {
        await this.travel();
        this.map.set(key, value);
    }
    // Like SET ... XX: the store checks the key when the command arrives.
    async setIfExists(key: string, value: unknown) {
        await this.travel();
        if (!this.map.has(key)) return false;
        this.map.set(key, value);
        return true;
    }
    async delete(key: string) {
        this.map.delete(key);
    }
    async exists(key: string) {
        return this.map.has(key);
    }
}

describe('Session Feature', () => {
    it('should initialize with memory store', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(
            new SessionFeature({
                store: 'memory',
                secret: 'test-secret-key-0123456789abcdef0123456789abcdef',
            }),
        );
        await kernel.initialize();

        const app = kernel.getApp();
        app.get('/session', (c) => {
            const session = c.get('session');
            return c.json({ session, sessionId: c.get('sessionId') });
        });

        const res = await app.request('/session');
        expect(res.status).toBe(200);
        const json = (await res.json()) as any;
        expect(json.sessionId).toBeDefined();
        expect(json.session).toEqual({});

        await kernel.shutdown();
    });

    it('should create session and set cookie on write', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(
            new SessionFeature({
                store: 'memory',
                secret: 'test-secret-0123456789abcdef0123456789abcdef',
            }),
        );
        await kernel.initialize();

        const app = kernel.getApp();
        app.get('/login', (c) => {
            const session = c.get('session');
            session.user = 'testuser';
            session.role = 'admin';
            return c.json({ ok: true });
        });

        const res = await app.request('/login');
        expect(res.status).toBe(200);

        // Check that a Set-Cookie header was set
        const setCookie = res.headers.get('Set-Cookie');
        expect(setCookie).toBeDefined();
        expect(setCookie).toContain('sid=');

        await kernel.shutdown();
    });

    it('should restore session from signed cookie', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(
            new SessionFeature({
                store: 'memory',
                secret: 'restore-test-secret-0123456789abcdef0123456789abcdef',
            }),
        );
        await kernel.initialize();

        const app = kernel.getApp();

        app.get('/set', (c) => {
            const session = c.get('session');
            session.value = 'persisted';
            return c.json({ sessionId: c.get('sessionId') });
        });

        app.get('/get', (c) => {
            return c.json({ session: c.get('session') });
        });

        // Set session
        const setRes = await app.request('/set');
        const setCookie = setRes.headers.get('Set-Cookie');
        expect(setCookie).toBeDefined();

        // Extract cookie value
        const cookieValue = setCookie!.split(';')[0]; // "sid=..."

        // Get session with cookie
        const getRes = await app.request('/get', {
            headers: { Cookie: cookieValue },
        });
        const json = (await getRes.json()) as any;
        expect(json.session.value).toBe('persisted');

        await kernel.shutdown();
    });

    it('should reject tampered cookies', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(
            new SessionFeature({
                store: 'memory',
                secret: 'tamper-test-0123456789abcdef0123456789abcdef',
            }),
        );
        await kernel.initialize();

        const app = kernel.getApp();
        app.get('/check', (c) => {
            return c.json({ session: c.get('session'), id: c.get('sessionId') });
        });

        // Send a tampered cookie
        const res = await app.request('/check', {
            headers: { Cookie: 'sid=fake-id.invalid-signature' },
        });
        const json = (await res.json()) as any;
        // Should get a new empty session (tampered cookie rejected)
        expect(json.session).toEqual({});

        await kernel.shutdown();
    });

    it('should initialize with cache store', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new CacheFeature({ adapter: 'memory' }));
        kernel.registerFeature(
            new SessionFeature({
                store: 'cache',
                secret: 'cache-session-test-0123456789abcdef0123456789abcdef',
            }),
        );
        await kernel.initialize();

        const app = kernel.getApp();
        app.get('/session', (c) => {
            const session = c.get('session');
            session.data = 'from-cache-store';
            return c.json({ ok: true });
        });

        const res = await app.request('/session');
        expect(res.status).toBe(200);

        await kernel.shutdown();
    });

    it('persists, restores and destroys a session via the cache store', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new CacheFeature({ adapter: 'memory' }));
        kernel.registerFeature(
            new SessionFeature({ store: 'cache', secret: 'cache-restore-0123456789abcdef0123456789abcdef' }),
        );
        await kernel.initialize();

        const app = kernel.getApp();
        app.get('/set', (c) => {
            c.get('session').v = 'cached';
            return c.json({ ok: true });
        });
        app.get('/get', (c) => c.json({ session: c.get('session') }));
        app.get('/logout', async (c) => {
            await c.get('destroySession')();
            return c.json({ ok: true });
        });

        const setRes = await app.request('/set');
        const cookie = setRes.headers.get('Set-Cookie')!.split(';')[0];

        // Second request with the cookie reads the value back through CacheSessionStore.get
        const getJson = (await (await app.request('/get', { headers: { Cookie: cookie } })).json()) as any;
        expect(getJson.session.v).toBe('cached');

        // destroySession routes through CacheSessionStore.destroy
        const logoutRes = await app.request('/logout', { headers: { Cookie: cookie } });
        expect(logoutRes.status).toBe(200);

        await kernel.shutdown();
    });

    it('should support custom cookie name', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(
            new SessionFeature({
                store: 'memory',
                secret: 'custom-cookie-0123456789abcdef0123456789abcdef',
                cookieName: 'my_session',
            }),
        );
        await kernel.initialize();

        const app = kernel.getApp();
        app.get('/custom', (c) => {
            const session = c.get('session');
            session.test = true;
            return c.json({ ok: true });
        });

        const res = await app.request('/custom');
        const setCookie = res.headers.get('Set-Cookie');
        expect(setCookie).toContain('my_session=');

        await kernel.shutdown();
    });

    it('should support destroySession', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(
            new SessionFeature({
                store: 'memory',
                secret: 'destroy-test-0123456789abcdef0123456789abcdef',
            }),
        );
        await kernel.initialize();

        const app = kernel.getApp();
        app.get('/logout', async (c) => {
            const destroy = c.get('destroySession');
            await destroy();
            return c.json({ ok: true });
        });

        const res = await app.request('/logout');
        expect(res.status).toBe(200);

        await kernel.shutdown();
    });

    it('destroySession ends the session even if the handler does not clear it', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(
            new SessionFeature({
                store: 'memory',
                secret: 'destroy-real-0123456789abcdef0123456789abcdef',
            }),
        );
        await kernel.initialize();

        const app = kernel.getApp();
        app.get('/login', (c) => {
            c.get('session').user = 'ada';
            return c.json({ ok: true });
        });
        app.get('/me', (c) => c.json({ session: c.get('session') }));
        // Deliberately does NOT clear the session object — destroySession alone must suffice.
        app.get('/logout', async (c) => {
            await c.get('destroySession')();
            return c.json({ ok: true });
        });

        const cookie = (await app.request('/login')).headers.get('Set-Cookie')!.split(';')[0];

        const before = (await (await app.request('/me', { headers: { Cookie: cookie } })).json()) as any;
        expect(before.session.user).toBe('ada');

        await app.request('/logout', { headers: { Cookie: cookie } });

        // The destroyed session must NOT be re-persisted by the save-after-response logic.
        const after = (await (await app.request('/me', { headers: { Cookie: cookie } })).json()) as any;
        expect(after.session).toEqual({});

        await kernel.shutdown();
    });

    describe('hardening', () => {
        const SECRET = 'hardening-secret-0123456789abcdef0123456789';
        const cookieOf = (res: Response) => res.headers.get('Set-Cookie')!.split(';')[0];

        async function app(kernel = new Kernel(), store: 'memory' | 'cache' = 'memory') {
            if (store === 'cache') kernel.registerFeature(new CacheFeature({ adapter: 'memory' }));
            kernel.registerFeature(new SessionFeature({ store, secret: SECRET }));
            await kernel.initialize();
            const a = kernel.getApp();
            a.get('/login', async (c) => {
                if (c.req.query('regenerate')) await c.get('regenerateSession')();
                c.get('session').userId = 'u1';
                return c.json({ id: c.get('sessionId') });
            });
            a.get('/logout', (c) => {
                delete c.get('session').userId;
                return c.json({ ok: true });
            });
            a.get('/me', (c) => c.json({ session: c.get('session') }));
            return { kernel, a };
        }

        it('rejects a secret shorter than 32 characters', () => {
            expect(() => new SessionFeature({ store: 'memory', secret: 'short' })).toThrow(/at least 32 characters/);
        });

        for (const store of ['memory', 'cache'] as const) {
            it(`logs out when the handler empties the session (${store} store)`, async () => {
                // Regression: an emptied session was simply not saved, so the old
                // data loaded again on the next request and logout did nothing.
                const { kernel, a } = await app(new Kernel(), store);
                const cookie = cookieOf(await a.request('/login'));

                const out = await a.request('/logout', { headers: { Cookie: cookie } });
                expect(out.headers.get('Set-Cookie')).toContain('Max-Age=0');

                const me = (await (await a.request('/me', { headers: { Cookie: cookie } })).json()) as any;
                expect(me.session).toEqual({});
                await kernel.shutdown();
            });
        }

        it('regenerateSession issues a new ID and invalidates the old one', async () => {
            const { kernel, a } = await app();
            const before = cookieOf(await a.request('/login'));

            const res = await a.request('/login?regenerate=1', { headers: { Cookie: before } });
            const after = cookieOf(res);
            expect(after).not.toBe(before);

            const oldMe = (await (await a.request('/me', { headers: { Cookie: before } })).json()) as any;
            expect(oldMe.session).toEqual({});
            const newMe = (await (await a.request('/me', { headers: { Cookie: after } })).json()) as any;
            expect(newMe.session).toEqual({ userId: 'u1' });
            await kernel.shutdown();
        });

        for (const store of ['memory', 'cache'] as const) {
            it(`a request in flight does not revive a session destroyed meanwhile (${store} store)`, async () => {
                // Regression: the slow request re-saved the session after the
                // other request's logout / regenerateSession, which undid the
                // logout; with the memory store (one shared object) it even
                // saved the login's userId under the old, attacker-known ID.
                const { kernel, a } = await app(new Kernel(), store);
                let release!: () => void;
                let entered!: () => void;
                const inHandler = new Promise<void>((r) => (entered = r));
                a.get('/slow', async (c) => {
                    c.get('session').seen = true;
                    entered();
                    await new Promise<void>((r) => (release = r));
                    return c.json({ ok: true });
                });
                a.get('/visit', (c) => {
                    c.get('session').cart = ['book'];
                    return c.json({ ok: true });
                });

                // Session fixation: the victim's browser carries the attacker's ID.
                const fixed = cookieOf(await a.request('/visit'));
                const slow = a.request('/slow', { headers: { Cookie: fixed } });
                await inHandler;
                const login = await a.request('/login?regenerate=1', { headers: { Cookie: fixed } });
                release();
                await slow;

                const oldMe = (await (await a.request('/me', { headers: { Cookie: fixed } })).json()) as {
                    session: Record<string, unknown>;
                };
                expect(oldMe.session.userId).toBeUndefined();
                const newMe = (await (await a.request('/me', { headers: { Cookie: cookieOf(login) } })).json()) as {
                    session: Record<string, unknown>;
                };
                expect(newMe.session.userId).toBe('u1');

                // Logout in one tab while another request is in flight.
                const session = cookieOf(await a.request('/login'));
                const inHandler2 = new Promise<void>((r) => (entered = r));
                const slow2 = a.request('/slow', { headers: { Cookie: session } });
                await inHandler2;
                await a.request('/logout', { headers: { Cookie: session } });
                release();
                await slow2;
                const me = (await (await a.request('/me', { headers: { Cookie: session } })).json()) as {
                    session: Record<string, unknown>;
                };
                expect(me.session).toEqual({});
                await kernel.shutdown();
            });
        }

        it('a save does not re-create a session deleted while the write was on its way (cache store)', async () => {
            // Regression: the save checked that the session still existed
            // (get) and then wrote it (set). With Redis, a logout landing
            // between the two was undone by the write.
            const cache = new SlowWritesCache();
            const kernel = new Kernel({ logger: false });
            kernel.registerFeature({ name: 'cache', client: cache, async initialize() {} } as Feature);
            kernel.registerFeature(new SessionFeature({ store: 'cache', secret: SECRET }));
            await kernel.initialize();
            const a = kernel.getApp();
            a.get('/login', (c) => {
                c.get('session').userId = 'u1';
                return c.json({ ok: true });
            });
            a.get('/touch', (c) => {
                c.get('session').lastSeen = Date.now();
                return c.json({ ok: true });
            });
            a.get('/logout', async (c) => {
                await c.get('destroySession')();
                return c.json({ ok: true });
            });
            a.get('/me', (c) => c.json({ session: c.get('session') }));

            const cookie = cookieOf(await a.request('/login'));
            cache.whileWriting = async () => {
                await a.request('/logout', { headers: { Cookie: cookie } });
            };
            await a.request('/touch', { headers: { Cookie: cookie } });

            const me = (await (await a.request('/me', { headers: { Cookie: cookie } })).json()) as any;
            expect(me.session).toEqual({});
            await kernel.shutdown();
        });

        it('marks the cookie Secure in production unless overridden', async () => {
            const prod = await app(new Kernel({ environment: 'production' }));
            expect((await prod.a.request('/login')).headers.get('Set-Cookie')).toContain('Secure');
            await prod.kernel.shutdown();

            const dev = await app(new Kernel({ environment: 'development' }));
            expect((await dev.a.request('/login')).headers.get('Set-Cookie')).not.toContain('Secure');
            await dev.kernel.shutdown();
        });
    });
});
