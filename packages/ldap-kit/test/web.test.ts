import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { Kernel, anyOf, bearer, documentRoutes, describeRoute, requireActor } from '@iskra-bun/web-kit';
import { LdapDirectory } from '../src/index';
import { ldapPassword } from '../src/web';
import { entry, fakeTransport, invalidCredentials } from './fake-transport';

const ANA_DN = 'uid=ana,ou=people,dc=iskra,dc=test';

function ldapWith(bind: (dn: string, password: string) => void) {
    const { factory } = fakeTransport({
        bind: (dn, password) => (dn === ANA_DN ? bind(dn, password) : undefined),
        search: (_base, search) =>
            search.filter.includes('(uid=ana)')
                ? [entry(ANA_DN, { uid: ['ana'], mail: ['ana@iskra.test'], entryUUID: ['7d3c…'] })]
                : search.filter.includes('member=')
                  ? [entry('cn=devs,ou=groups,dc=iskra,dc=test', { cn: ['devs'] })]
                  : [],
    });
    return new LdapDirectory({
        url: 'ldap://ldap',
        baseDN: 'dc=iskra,dc=test',
        bindDN: 'cn=readonly,dc=iskra,dc=test',
        bindPassword: 'readonly',
        directory: 'openldap',
        transport: factory,
    });
}

const basic = (login: string, password: string) => ({
    Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`,
});

async function appWith(ldap: LdapDirectory, options: Parameters<typeof ldapPassword>[1] = {}) {
    const kernel = new Kernel({ logger: false });
    await kernel.initialize();
    const app = kernel.getApp();
    app.get('/me', requireActor(ldapPassword(ldap, options)), (c) => c.json(c.get('actor')));
    return app;
}

describe('ldapPassword gate', () => {
    it('takes Basic credentials and puts the user in c.var.actor', async () => {
        const app = await appWith(
            ldapWith((_dn, password) => {
                if (password !== 'pässword:with:colons') throw invalidCredentials();
            }),
            { groups: 'nested' },
        );
        const res = await app.request('/me', { headers: basic('ana', 'pässword:with:colons') });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            kind: 'user',
            id: 'ana',
            dn: ANA_DN,
            guid: '7d3c…',
            email: 'ana@iskra.test',
            groups: ['devs'],
        });
    });

    it('answers the same 401 whatever the reason, with the Basic challenge', async () => {
        const app = await appWith(
            ldapWith(() => {
                throw invalidCredentials('775');
            }),
            { realm: 'core' },
        );
        for (const headers of [basic('ana', 'wrong'), basic('nobody', 'x'), basic('ana', '')]) {
            const res = await app.request('/me', { headers });
            expect(res.status).toBe(401);
            expect(res.headers.get('WWW-Authenticate')).toBe('Basic realm="core", charset="UTF-8"');
            expect(((await res.json()) as { error: string }).error).toBe('Invalid credentials');
        }
        // No credentials: the gate's challenge.
        expect((await app.request('/me')).headers.get('WWW-Authenticate')).toBe('Basic realm="core", charset="UTF-8"');
    });

    it('answers 503 when the directory cannot be reached, even inside anyOf()', async () => {
        const down = ldapWith(() => {
            throw new Error('connect ECONNREFUSED');
        });
        const kernel = new Kernel({ logger: false });
        await kernel.initialize();
        const app = kernel.getApp();
        const token = bearer(async () => null);
        app.get('/me', requireActor(anyOf(token, ldapPassword(down))), (c) => c.json(c.get('actor')));

        const res = await app.request('/me', { headers: basic('ana', 'secret') });
        expect(res.status).toBe(503);
        expect(await res.json()).toMatchObject({ code: 'SERVICE_UNAVAILABLE', error: 'Service Unavailable' });
    });

    it('states HTTP Basic as its scheme in the OpenAPI document', () => {
        const app = new Hono();
        app.get('/me', describeRoute({}), requireActor(ldapPassword(ldapWith(() => undefined))), (c) => c.text('ok'));
        const doc = documentRoutes(app.routes) as {
            paths: Record<string, Record<string, any>>;
            securitySchemes: object;
        };
        expect(doc.paths['/me']!.get.security).toEqual([{ basic: [] }]);
        expect(doc.securitySchemes).toEqual({ basic: { type: 'http', scheme: 'basic' } });
    });
});
