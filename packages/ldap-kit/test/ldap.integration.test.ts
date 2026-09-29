import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { Attribute, Change } from 'ldapts';
import { LdapDirectory, ldaptsTransport, type LdapConfig, type LdapTransportFactory } from '../src/index';
import { LDAP, adminClient, ldapUp } from './ldap-env';

// ldap-kit end to end against OpenLDAP: logins, users, nested groups, paged
// searches, changes and TLS. Every transport in TRANSPORTS passes the same
// suite, so a new one (a client of our own) proves it behaves the same.
// Skipped unless the server in ldap-env.ts is reachable; the `ldap` CI job
// provides one.
setDefaultTimeout(30_000);

const up = await ldapUp();
const TRANSPORTS: Array<[string, LdapTransportFactory]> = [['ldapts', ldaptsTransport]];

/** This run's subtree: its entries never meet another run's. */
const RUN = `ou=run-${randomBytes(4).toString('hex')},${LDAP.root}`;
const PEOPLE = `ou=people,${RUN}`;
const GROUPS = `ou=groups,${RUN}`;
const dn = (rdn: string, parent: string) => `${rdn},${parent}`;
const SEEDED_AT = new Date();

const person = (uid: string, extra: Record<string, string | string[]> = {}) => ({
    objectClass: ['inetOrgPerson'],
    uid,
    cn: uid,
    sn: uid,
    ...extra,
});

async function seed(): Promise<void> {
    const admin = await adminClient();
    try {
        await admin.add(RUN, { objectClass: ['organizationalUnit'], ou: RUN.split(',')[0]!.slice(3) });
        for (const ou of ['people', 'groups', 'others']) {
            await admin.add(`ou=${ou},${RUN}`, { objectClass: ['organizationalUnit'], ou });
        }
        await admin.add(
            dn('uid=ana', PEOPLE),
            person('ana', { cn: 'Ana Pérez', sn: 'Pérez', mail: 'ana@iskra.test', userPassword: 'ana-pass' }),
        );
        await admin.add(dn('uid=bob', PEOPLE), person('bob', { userPassword: 'pässwörd' }));
        await admin.add(dn('uid=dup', PEOPLE), person('dup', { userPassword: 'x' }));
        await admin.add(dn('uid=dup', `ou=others,${RUN}`), person('dup', { userPassword: 'x' }));
        for (let i = 1; i <= 25; i++) {
            const uid = `user${String(i).padStart(2, '0')}`;
            await admin.add(dn(`uid=${uid}`, PEOPLE), person(uid));
        }
        // Nested three levels deep, member and uniqueMember mixed, and a cycle.
        const unique = (cn: string, members: string[]) =>
            admin.add(dn(`cn=${cn}`, GROUPS), { objectClass: ['groupOfUniqueNames'], cn, uniqueMember: members });
        const names = (cn: string, members: string[]) =>
            admin.add(dn(`cn=${cn}`, GROUPS), { objectClass: ['groupOfNames'], cn, member: members });
        await unique('devs', [dn('uid=ana', PEOPLE)]);
        await unique('engineering', [dn('cn=devs', GROUPS)]);
        await names('company', [dn('cn=engineering', GROUPS)]);
        await names('admins', [dn('uid=bob', PEOPLE)]);
        await names('cycle-a', [dn('uid=ana', PEOPLE)]);
        await names('cycle-b', [dn('cn=cycle-a', GROUPS)]);
        await admin.modify(
            dn('cn=cycle-a', GROUPS),
            new Change({
                operation: 'add',
                modification: new Attribute({ type: 'member', values: [dn('cn=cycle-b', GROUPS)] }),
            }),
        );
    } finally {
        await admin.unbind();
    }
}

async function cleanup(): Promise<void> {
    const admin = await adminClient();
    try {
        const { searchEntries } = await admin.search(RUN, { scope: 'sub', attributes: ['1.1'] });
        // Leaves first.
        const dns = searchEntries.map((e) => e.dn).sort((a, b) => b.split(',').length - a.split(',').length);
        for (const each of dns) await admin.del(each).catch(() => undefined);
    } finally {
        await admin.unbind();
    }
}

(up ? describe : describe.skip)('LdapDirectory against OpenLDAP', () => {
    beforeAll(seed);
    afterAll(cleanup);

    for (const [name, transport] of TRANSPORTS) {
        describe(`transport: ${name}`, () => {
            const config: LdapConfig = {
                url: LDAP.url,
                baseDN: RUN,
                bindDN: LDAP.bindDN,
                bindPassword: LDAP.bindPassword,
                directory: 'openldap',
                pageSize: 10,
                transport,
            };
            const ldap = new LdapDirectory(config);

            test('authenticates a user and reads it', async () => {
                const result = await ldap.authenticate('ana', 'ana-pass');
                expect(result.ok).toBe(true);
                if (!result.ok) return;
                expect(result.user).toMatchObject({
                    dn: dn('uid=ana', PEOPLE),
                    username: 'ana',
                    displayName: 'Ana Pérez',
                    email: 'ana@iskra.test',
                    surname: 'Pérez',
                    disabled: false,
                    locked: false,
                });
                expect(result.user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
                // memberOf, kept by the overlay for groupOfUniqueNames.
                expect(result.user.memberOf.map((g) => g.split(',')[0])).toContain('cn=devs');
                // A UTF-8 password.
                expect((await ldap.authenticate('bob', 'pässwörd')).ok).toBe(true);
            });

            test('refuses wrong, missing, empty, ambiguous and injected logins', async () => {
                expect(await ldap.authenticate('ana', 'wrong')).toEqual({ ok: false, reason: 'invalid_credentials' });
                expect(await ldap.authenticate('nobody', 'x')).toEqual({ ok: false, reason: 'user_not_found' });
                expect(await ldap.authenticate('ana', '')).toEqual({ ok: false, reason: 'empty_password' });
                expect(await ldap.authenticate('dup', 'x')).toEqual({ ok: false, reason: 'ambiguous_user' });
                expect(await ldap.authenticate('*', 'ana-pass')).toEqual({ ok: false, reason: 'user_not_found' });
                expect(await ldap.authenticate('ana)(uid=*', 'ana-pass')).toEqual({
                    ok: false,
                    reason: 'user_not_found',
                });
            });

            test('finds groups, direct and nested, through a cycle', async () => {
                const names = async (nested: boolean) =>
                    (await ldap.groupsOf(dn('uid=ana', PEOPLE), { nested })).map((g) => g.name).sort();
                expect(await names(false)).toEqual(['cycle-a', 'devs']);
                expect(await names(true)).toEqual(['company', 'cycle-a', 'cycle-b', 'devs', 'engineering']);

                const result = await ldap.authenticate('ana', 'ana-pass', { groups: 'direct' });
                expect(result.ok && result.user.groups?.map((g) => g.name).sort()).toEqual(['cycle-a', 'devs']);
            });

            test('finds users by login and by DN', async () => {
                expect((await ldap.findUser('ana'))?.dn).toBe(dn('uid=ana', PEOPLE));
                expect(await ldap.findUser('dup')).toBeNull();
                expect((await ldap.findUserByDN(dn('uid=bob', PEOPLE)))?.username).toBe('bob');
                expect(await ldap.findUserByDN(dn('uid=ghost', PEOPLE))).toBeNull();
            });

            test('searches page by page', async () => {
                const sizes: number[] = [];
                for await (const page of ldap.searchPages({
                    base: PEOPLE,
                    filter: '(uid=user*)',
                    attributes: ['uid'],
                })) {
                    sizes.push(page.length);
                }
                expect(sizes).toEqual([10, 10, 5]);
                expect(await ldap.search({ base: PEOPLE, filter: '(uid=user*)', attributes: ['uid'] })).toHaveLength(
                    25,
                );
            });

            test('lists what changed since a date', async () => {
                const since = await ldap.changesSince({ date: new Date(SEEDED_AT.getTime() - 60_000) });
                expect(since.entries.map((e) => e.get('uid'))).toContain('ana');
                expect(since.entries[0]!.date('modifyTimestamp')).toBeInstanceOf(Date);
                const later = await ldap.changesSince({ date: new Date(Date.now() + 3_600_000) });
                expect(later.entries).toEqual([]);
                await expect(ldap.changesSince({ usn: 1 })).rejects.toThrow('Active Directory');
            });

            test('pings, and fails over to the next url', async () => {
                const ping = await new LdapDirectory({ ...config, url: ['ldap://127.0.0.1:1', LDAP.url] }).ping();
                expect(ping.url).toBe(LDAP.url);
                expect(ping.rootDSE.getAll('namingContexts')).toContain(LDAP.root);
                expect(await ldap.healthCheck()()).toMatchObject({ status: 'ok' });
            });

            test('reports a wrong service password and an unreachable server', async () => {
                const wrong = new LdapDirectory({ ...config, bindPassword: 'nope' });
                expect(await wrong.findUser('ana').catch((e: unknown) => e)).toMatchObject({ code: 'CONFIG_INVALID' });

                const down = new LdapDirectory({ ...config, url: 'ldap://127.0.0.1:1', connectTimeoutMs: 1000 });
                expect(await down.findUser('ana').catch((e: unknown) => e)).toMatchObject({
                    code: 'SERVICE_UNAVAILABLE',
                });
            });

            (LDAP.ca ? test : test.skip)('connects with StartTLS and ldaps://, checking the CA', async () => {
                const tls = { ca: LDAP.ca, servername: LDAP.servername };
                const startTLS = new LdapDirectory({ ...config, startTLS: true, tls });
                expect((await startTLS.authenticate('ana', 'ana-pass')).ok).toBe(true);
                if (LDAP.ldapsUrl) {
                    const ldaps = new LdapDirectory({ ...config, url: LDAP.ldapsUrl, tls });
                    expect((await ldaps.authenticate('ana', 'ana-pass')).ok).toBe(true);
                }
                // Without the CA the certificate is refused.
                const untrusted = new LdapDirectory({
                    ...config,
                    startTLS: true,
                    tls: { servername: LDAP.servername },
                });
                expect(await untrusted.ping().catch((e: unknown) => e)).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
            });
        });
    }
});
