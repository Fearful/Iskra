import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Jwt } from 'hono/utils/jwt';
import {
    ApiKeyFeature,
    Kernel,
    Router,
    allOf,
    anyOf,
    apiKey,
    bearer,
    hashApiKey,
    hashedKeys,
    identify,
    jwt,
    requireActor,
    requireScopes,
    session,
    staticKeys,
    type Actor,
    type Gate,
} from '../src/index';
import type { Hono } from '../src/hono';

const SECRET = 'a-test-secret-of-at-least-32-characters!';

async function appWith(setup: (app: Hono) => void, features: unknown[] = []) {
    const kernel = new Kernel({ logger: false });
    for (const feature of features) kernel.registerFeature(feature as never);
    await kernel.initialize();
    const app = kernel.getApp();
    setup(app);
    return app;
}

/** A route behind `gate` that answers the actor. */
const behind = (gate: Gate) => (app: Hono) => app.get('/me', requireActor(gate), (c) => c.json(c.var.actor));

const token = (claims: Record<string, unknown>) =>
    Jwt.sign({ exp: Math.floor(Date.now() / 1000) + 60, ...claims }, SECRET, 'HS256');
const auth = (value: string) => ({ headers: { Authorization: value } });

describe('bearer()', () => {
    const gate = bearer((t) => (t === 'good' ? { kind: 'service', id: 'svc-1' } : null));

    it('takes the actor the check returns', async () => {
        const app = await appWith(behind(gate));
        expect(await (await app.request('/me', auth('Bearer good'))).json()).toEqual({ kind: 'service', id: 'svc-1' });
    });

    it('answers 401 with a challenge, and invalid_token for a token it does not accept', async () => {
        const app = await appWith(behind(gate));
        const none = await app.request('/me');
        expect(none.status).toBe(401);
        expect(none.headers.get('WWW-Authenticate')).toBe('Bearer');
        expect(await none.json()).toEqual({ error: 'Unauthorized', status: 401, code: 'UNAUTHORIZED' });

        const bad = await app.request('/me', auth('Bearer nope'));
        expect(bad.status).toBe(401);
        expect(bad.headers.get('WWW-Authenticate')).toBe('Bearer error="invalid_token"');
    });
});

describe('jwt()', () => {
    it('verifies a token signed with a secret: subject, scopes, issuer and audience', async () => {
        const gate = jwt({ secret: SECRET, issuer: 'https://idp', audience: 'core' });
        const app = await appWith(behind(gate));
        const good = await token({ sub: 42, scope: 'users:read users:write', iss: 'https://idp', aud: 'core' });
        const body = (await (await app.request('/me', auth(`Bearer ${good}`))).json()) as Actor & { claims: unknown };
        expect(body).toMatchObject({ kind: 'user', id: '42', scopes: ['users:read', 'users:write'] });

        for (const claims of [
            { sub: 1, iss: 'https://other', aud: 'core' },
            { sub: 1, iss: 'https://idp', aud: 'another' },
            { sub: 1, iss: 'https://idp', aud: 'core', exp: Math.floor(Date.now() / 1000) - 10 },
        ]) {
            const res = await app.request('/me', auth(`Bearer ${await token(claims)}`));
            expect(res.status).toBe(401);
        }
        expect((await app.request('/me', auth('Bearer not.a.jwt'))).status).toBe(401);
    });

    describe('with a JWKS', () => {
        let server: ReturnType<typeof Bun.serve>;
        let privateKey: CryptoKey;

        beforeAll(async () => {
            const pair = (await crypto.subtle.generateKey(
                {
                    name: 'RSASSA-PKCS1-v1_5',
                    modulusLength: 2048,
                    publicExponent: new Uint8Array([1, 0, 1]),
                    hash: 'SHA-256',
                },
                true,
                ['sign', 'verify'],
            )) as CryptoKeyPair;
            privateKey = pair.privateKey;
            const jwk = {
                ...(await crypto.subtle.exportKey('jwk', pair.publicKey)),
                kid: 'k1',
                alg: 'RS256',
                use: 'sig',
            };
            server = Bun.serve({ port: 0, fetch: () => Response.json({ keys: [jwk] }) });
        });
        afterAll(() => server.stop(true));

        it("verifies a token with the provider's keys", async () => {
            const gate = jwt({ jwksUri: `http://localhost:${server.port}/jwks` });
            const app = await appWith(behind(gate));
            // Signed with the private key as a JWK, so the token's header names its kid.
            const privateJwk = { ...(await crypto.subtle.exportKey('jwk', privateKey)), kid: 'k1', alg: 'RS256' };
            const withKid = await Jwt.sign(
                { sub: 'ana', exp: Math.floor(Date.now() / 1000) + 60 },
                privateJwk as never,
                'RS256',
            );
            const res = await app.request('/me', auth(`Bearer ${withKid}`));
            expect(res.status).toBe(200);
            expect(await res.json()).toMatchObject({ kind: 'user', id: 'ana' });
        });
    });

    it('takes either a secret or a JWKS URL', () => {
        expect(() => jwt({})).toThrow('either `secret` or `jwksUri`');
    });
});

describe('apiKey()', () => {
    const keys = staticKeys([
        { key: 'sk-live-1', id: 'reports', scopes: ['reports:read'] },
        { key: 'sk-old', id: 'old', expiresAt: new Date(Date.now() - 1000) },
    ]);

    it('finds a key from X-API-Key, and refuses an unknown or expired one', async () => {
        const app = await appWith(behind(apiKey(keys)));
        const ok = await app.request('/me', { headers: { 'X-API-Key': 'sk-live-1' } });
        expect(await ok.json()).toEqual({ kind: 'apiKey', id: 'reports', scopes: ['reports:read'] });

        const unknown = await app.request('/me', { headers: { 'X-API-Key': 'sk-nope' } });
        expect(unknown.status).toBe(401);
        expect(((await unknown.json()) as { error: string }).error).toBe('Invalid API key');
        const expired = await app.request('/me', { headers: { 'X-API-Key': 'sk-old' } });
        expect(((await expired.json()) as { error: string }).error).toBe('API key has expired');
        expect((await app.request('/me')).status).toBe(401);
    });

    it('takes the key from a bearer token or a query parameter when asked', async () => {
        const app = await appWith(behind(apiKey(keys, { header: false, bearer: true, query: 'api_key' })));
        expect((await app.request('/me', auth('Bearer sk-live-1'))).status).toBe(200);
        expect((await app.request('/me?api_key=sk-live-1')).status).toBe(200);
        expect((await app.request('/me', { headers: { 'X-API-Key': 'sk-live-1' } })).status).toBe(401);
    });

    it('looks a key up by its hash in a table of its own', async () => {
        const hashes: string[] = [];
        const table = hashedKeys(async (hash) => {
            hashes.push(hash);
            return hash === hashApiKey('sk-db') ? { id: 'db-key', scopes: ['*'] } : null;
        });
        const app = await appWith(behind(apiKey(table)));
        expect((await app.request('/me', { headers: { 'X-API-Key': 'sk-db' } })).status).toBe(200);
        expect(hashes).toEqual([hashApiKey('sk-db')]);
        expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe('anyOf() and allOf()', () => {
    const keys = staticKeys([{ key: 'sk-live-1', id: 'reports' }]);

    it('takes the first gate that proves an actor, even after one refused the credential', async () => {
        const gate = anyOf(jwt({ secret: SECRET }), apiKey(keys, { bearer: true }));
        const app = await appWith(behind(gate));
        const user = await app.request('/me', auth(`Bearer ${await token({ sub: 'ana' })}`));
        expect(await user.json()).toMatchObject({ kind: 'user', id: 'ana' });
        // Not a JWT, but an API key sent as a bearer token.
        const service = await app.request('/me', auth('Bearer sk-live-1'));
        expect(await service.json()).toEqual({ kind: 'apiKey', id: 'reports' });
    });

    it("answers the first refusal when none proves one, and the gates' challenge without a credential", async () => {
        const gate = anyOf(jwt({ secret: SECRET }), apiKey(keys, { bearer: true }));
        const app = await appWith(behind(gate));
        const bad = await app.request('/me', auth('Bearer nothing-valid'));
        expect(bad.status).toBe(401);
        expect(bad.headers.get('WWW-Authenticate')).toBe('Bearer error="invalid_token"');
        expect((await app.request('/me')).headers.get('WWW-Authenticate')).toBe('Bearer');
    });

    it('allOf() needs every gate', async () => {
        const client = bearer((t) => (t === 'cert' ? { kind: 'client', id: 'c1' } : null));
        const gate = allOf(client, apiKey(keys));
        const app = await appWith(behind(gate));
        expect((await app.request('/me', auth('Bearer cert'))).status).toBe(401);
        const both = await app.request('/me', { headers: { Authorization: 'Bearer cert', 'X-API-Key': 'sk-live-1' } });
        expect(await both.json()).toEqual({ kind: 'client', id: 'c1' });
    });
});

describe('session(), identify() and requireScopes()', () => {
    it("takes the session's user", async () => {
        const app = await appWith((a) => {
            a.use('*', async (c, next) => {
                if (c.req.header('Cookie') === 'session=1')
                    c.set('user' as never, { id: 'u1', email: 'a@b.c' } as never);
                await next();
            });
            behind(session())(a);
        });
        const res = await app.request('/me', { headers: { Cookie: 'session=1' } });
        expect(await res.json()).toMatchObject({ kind: 'user', id: 'u1', email: 'a@b.c' });
        expect((await app.request('/me')).status).toBe(401);
    });

    it('identify() lets a request without credentials through, and still refuses bad ones', async () => {
        const gate = apiKey(staticKeys([{ key: 'sk-1', id: 'k1' }]));
        const app = await appWith((a) => a.get('/feed', identify(gate), (c) => c.json({ actor: c.var.actor ?? null })));
        expect(await (await app.request('/feed')).json()).toEqual({ actor: null });
        expect(await (await app.request('/feed', { headers: { 'X-API-Key': 'sk-1' } })).json()).toEqual({
            actor: { kind: 'apiKey', id: 'k1' },
        });
        expect((await app.request('/feed', { headers: { 'X-API-Key': 'sk-2' } })).status).toBe(401);
    });

    it('requireScopes() answers 403 without the scope, with wildcards', async () => {
        const gate = apiKey(
            staticKeys([
                { key: 'reader', scopes: ['users:read'] },
                { key: 'admin', scopes: ['users:*'] },
            ]),
        );
        const app = await appWith((a) =>
            a.delete('/users/1', requireActor(gate), requireScopes('users:delete'), (c) => c.body(null, 204)),
        );
        const reader = await app.request('/users/1', { method: 'DELETE', headers: { 'X-API-Key': 'reader' } });
        expect(reader.status).toBe(403);
        expect(await reader.json()).toEqual({ error: 'Insufficient scopes', status: 403, code: 'FORBIDDEN' });
        expect((await app.request('/users/1', { method: 'DELETE', headers: { 'X-API-Key': 'admin' } })).status).toBe(
            204,
        );
    });
});

describe('gates with a Router', () => {
    it('answers 401 before 404 under a group that requires an actor', async () => {
        const router = new Router();
        const api = router.group('/api', requireActor(apiKey(staticKeys([{ key: 'sk-1', id: 'k1' }]))));
        api.get('/me', (c) => c.json(c.var.actor));
        api.unmatched();
        const kernel = new Kernel({ logger: false });
        await kernel.initialize();
        const app = router.compile(kernel.getApp());

        expect((await app.request('/api/nowhere')).status).toBe(401);
        expect((await app.request('/api/nowhere', { headers: { 'X-API-Key': 'sk-1' } })).status).toBe(404);
        expect(await (await app.request('/api/me', { headers: { 'X-API-Key': 'sk-1' } })).json()).toEqual({
            kind: 'apiKey',
            id: 'k1',
        });
    });
});

describe('ApiKeyFeature with a store', () => {
    it('accepts the keys of the store after its static ones', async () => {
        const store = hashedKeys((hash) => (hash === hashApiKey('sk-db') ? { id: 'db', scopes: ['a'] } : null));
        const app = await appWith(
            (a) =>
                a.get('/key', (c) =>
                    c.json({ id: c.get('apiKey')?.id ?? null, scopes: c.get('apiKeyScopes') ?? null }),
                ),
            [new ApiKeyFeature({ staticKeys: [{ key: 'sk-static', id: 'static' }], store })],
        );
        expect(await (await app.request('/key', { headers: { 'X-API-Key': 'sk-db' } })).json()).toEqual({
            id: 'db',
            scopes: ['a'],
        });
        expect((await app.request('/key', { headers: { 'X-API-Key': 'sk-nope' } })).status).toBe(401);
    });
});
