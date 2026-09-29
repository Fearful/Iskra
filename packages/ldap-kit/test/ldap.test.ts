import { describe, expect, it } from 'bun:test';
import {
    LdapDirectory,
    LdapEntry,
    LdapError,
    LdapTimeoutError,
    decodeAccountControl,
    decodeFileTime,
    decodeGeneralizedTime,
    decodeGuid,
    decodeSid,
    encodeGuid,
    escapeDnValue,
    escapeFilterValue,
    filterBytes,
    generalizedTime,
    ldapFilter,
    type LdapConfig,
} from '../src/index';
import { entry, fakeTransport, invalidCredentials, type FakeDirectory } from './fake-transport';

const AD_CONFIG = {
    url: 'ldap://dc1',
    baseDN: 'DC=corp,DC=example,DC=com',
    bindDN: 'svc@corp.example.com',
    bindPassword: 'svc-pass',
};

const ANA_DN = 'CN=Ana Pérez,OU=People,DC=corp,DC=example,DC=com';
const ANA = entry(ANA_DN, {
    sAMAccountName: ['ana'],
    userPrincipalName: ['ana@corp.example.com'],
    displayName: ['Ana Pérez'],
    mail: ['ana@example.com'],
    objectGUID: [encodeGuid('0c8f1b8e-3a2b-4d5e-9f10-112233445566')],
    memberOf: ['CN=Devs,OU=Groups,DC=corp,DC=example,DC=com'],
    userAccountControl: ['512'],
    lockoutTime: ['0'],
    accountExpires: ['9223372036854775807'],
});

function directory(fake: FakeDirectory, config: Partial<LdapConfig> = {}) {
    const { factory, calls } = fakeTransport(fake);
    return { ldap: new LdapDirectory({ ...AD_CONFIG, ...config, transport: factory }), calls };
}

/** A directory whose only user is Ana, with `password`. */
const anaDirectory = (refuse?: Error): FakeDirectory => ({
    bind: (dn, password) => {
        if (dn === ANA_DN && (refuse || password !== 'secret')) throw refuse ?? invalidCredentials();
    },
    search: (_base, search) => (search.filter.includes('(sAMAccountName=ana)') ? [ANA] : []),
});

describe('filters and DNs', () => {
    it('escapes filter values as RFC 4515 says', () => {
        expect(escapeFilterValue('*)(uid=*')).toBe('\\2a\\29\\28uid=\\2a');
        expect(escapeFilterValue('a\\b\0')).toBe('a\\5cb\\00');
        expect(escapeFilterValue('José')).toBe('José');
        expect(ldapFilter`(&(uid=${'x*'})(cn=${'(y)'}))`).toBe('(&(uid=x\\2a)(cn=\\28y\\29))');
    });

    it('escapes DN values as RFC 4514 says', () => {
        expect(escapeDnValue('Pérez, Ana')).toBe('Pérez\\, Ana');
        expect(escapeDnValue('#1 ')).toBe('\\#1\\ ');
        expect(escapeDnValue('a+b=c<d>;"e"')).toBe('a\\+b\\=c\\<d\\>\\;\\"e\\"');
    });

    it('writes and reads GeneralizedTime', () => {
        const date = new Date(Date.UTC(2024, 0, 31, 23, 59, 58));
        expect(generalizedTime(date)).toBe('20240131235958.0Z');
        expect(decodeGeneralizedTime('20240131235958.0Z')).toEqual(date);
        expect(decodeGeneralizedTime('20240131235958Z')).toEqual(date);
        expect(decodeGeneralizedTime('20240201015958+0200')).toEqual(date);
        expect(decodeGeneralizedTime('nope')).toBeNull();
    });
});

describe('Active Directory values', () => {
    it('reads GUIDs with their little-endian groups, and back', () => {
        const bytes = Uint8Array.from([
            0x8e, 0x1b, 0x8f, 0x0c, 0x2b, 0x3a, 0x5e, 0x4d, 0x9f, 0x10, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66,
        ]);
        expect(decodeGuid(bytes)).toBe('0c8f1b8e-3a2b-4d5e-9f10-112233445566');
        expect(encodeGuid('{0C8F1B8E-3A2B-4D5E-9F10-112233445566}')).toEqual(bytes);
        expect(filterBytes(bytes.slice(0, 2))).toBe('\\8e\\1b');
    });

    it('reads SIDs', () => {
        // S-1-5-21-1004336348-1177238915-682003330-512
        const sid = Uint8Array.from([
            1, 5, 0, 0, 0, 0, 0, 5, 21, 0, 0, 0, 0xdc, 0xf4, 0xdc, 0x3b, 0x83, 0x3d, 0x2b, 0x46, 0x82, 0x8b, 0xa6, 0x28,
            0x00, 0x02, 0x00, 0x00,
        ]);
        expect(decodeSid(sid)).toBe('S-1-5-21-1004336348-1177238915-682003330-512');
    });

    it('reads FILETIMEs, with 0 and the maximum as never', () => {
        expect(decodeFileTime('116444736000000000')).toEqual(new Date(0));
        expect(decodeFileTime('133000000000000000')).toEqual(new Date('2022-06-18T04:26:40.000Z'));
        expect(decodeFileTime('0')).toBeNull();
        expect(decodeFileTime('9223372036854775807')).toBeNull();
    });

    it("reads userAccountControl's flags", () => {
        expect(decodeAccountControl(514)).toMatchObject({ disabled: true, passwordNeverExpires: false });
        expect(decodeAccountControl('66048')).toMatchObject({ disabled: false, passwordNeverExpires: true });
    });

    it('reads entries by name ignoring case', () => {
        const e = new LdapEntry(ANA);
        expect(e.get('SAMACCOUNTNAME')).toBe('ana');
        expect(e.getAll('memberof')).toHaveLength(1);
        expect(e.guid()).toBe('0c8f1b8e-3a2b-4d5e-9f10-112233445566');
        expect(e.number('userAccountControl')).toBe(512);
        expect(e.date('accountExpires')).toBeNull();
        expect(e.has('missing')).toBe(false);
        expect(e.toJSON().attributes.objectGUID).toEqual([
            Buffer.from(encodeGuid('0c8f1b8e-3a2b-4d5e-9f10-112233445566')).toString('base64'),
        ]);
    });
});

describe('LdapDirectory.authenticate', () => {
    it('finds the user as the service account, then binds as the user', async () => {
        const { ldap, calls } = directory(anaDirectory());
        const result = await ldap.authenticate('ana', 'secret');

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.user).toMatchObject({
            dn: ANA_DN,
            username: 'ana',
            email: 'ana@example.com',
            id: '0c8f1b8e-3a2b-4d5e-9f10-112233445566',
            disabled: false,
            locked: false,
            expiresAt: null,
            memberOf: ['CN=Devs,OU=Groups,DC=corp,DC=example,DC=com'],
        });
        expect(calls.map((c) => `${c.op} ${c.dn ?? c.base ?? ''}`)).toEqual([
            'bind svc@corp.example.com',
            'search DC=corp,DC=example,DC=com',
            `bind ${ANA_DN}`,
            'close ',
        ]);
        expect(calls[1]!.search!.filter).toBe(
            '(&(objectCategory=person)(objectClass=user)(|(sAMAccountName=ana)(userPrincipalName=ana)))',
        );
    });

    it('takes a DOMAIN\\user login as the user, and escapes it', async () => {
        const { ldap, calls } = directory(anaDirectory());
        expect((await ldap.authenticate('CORP\\ana', 'secret')).ok).toBe(true);

        await ldap.authenticate('*)(sAMAccountName=*', 'secret');
        expect(calls.at(-2)!.search!.filter).toContain('(sAMAccountName=\\2a\\29\\28sAMAccountName=\\2a)');
    });

    it("tells Active Directory's reasons apart", async () => {
        const reasons: Record<string, string> = {
            '52e': 'invalid_credentials',
            '533': 'account_disabled',
            '775': 'account_locked',
            '532': 'password_expired',
            '773': 'password_must_change',
            '701': 'account_expired',
            '531': 'logon_not_permitted',
        };
        for (const [data, reason] of Object.entries(reasons)) {
            const { ldap } = directory(anaDirectory(invalidCredentials(data)));
            expect(await ldap.authenticate('ana', 'secret')).toEqual({ ok: false, reason } as never);
        }
    });

    it('refuses an empty password without asking the server (it would be an anonymous bind)', async () => {
        const { ldap, calls } = directory(anaDirectory());
        expect(await ldap.authenticate('ana', '')).toEqual({ ok: false, reason: 'empty_password' });
        expect(calls).toEqual([]);
    });

    it('refuses a login that matches no user or several', async () => {
        const { ldap } = directory({ search: (_b, s) => (s.filter.includes('=dup)') ? [ANA, ANA] : []) });
        expect(await ldap.authenticate('nobody', 'x')).toEqual({ ok: false, reason: 'user_not_found' });
        expect(await ldap.authenticate('dup', 'x')).toEqual({ ok: false, reason: 'ambiguous_user' });
    });

    it('reads the groups as the service account after the user binds', async () => {
        const { ldap, calls } = directory({
            ...anaDirectory(),
            search: (_base, search) =>
                search.filter.includes('sAMAccountName=ana')
                    ? [ANA]
                    : [entry('CN=Devs,OU=Groups,DC=corp,DC=example,DC=com', { cn: ['Devs'] })],
        });
        const result = await ldap.authenticate('ana', 'secret', { groups: 'nested' });

        expect(result.ok && result.user.groups?.map((g) => g.name)).toEqual(['Devs']);
        const binds = calls.filter((c) => c.op === 'bind').map((c) => c.dn);
        expect(binds).toEqual(['svc@corp.example.com', ANA_DN, 'svc@corp.example.com']);
        expect(calls.at(-2)!.search!.filter).toBe(
            '(&(objectClass=group)(member:1.2.840.113556.1.4.1941:=CN=Ana Pérez,OU=People,DC=corp,DC=example,DC=com))',
        );
    });
});

describe('LdapDirectory connections', () => {
    it('tries the next url when one cannot be reached, not when the server answers', async () => {
        const { ldap, calls } = directory(
            {
                bind: (_dn, _pw, url) => {
                    if (url === 'ldap://dc1') throw new Error('connect ECONNREFUSED');
                },
            },
            { url: ['ldap://dc1', 'ldap://dc2'] },
        );
        expect((await ldap.ping()).url).toBe('ldap://dc2');
        expect(calls.filter((c) => c.op === 'close').map((c) => c.url)).toEqual(['ldap://dc1', 'ldap://dc2']);
    });

    it('fails with SERVICE_UNAVAILABLE when no url answers, TIMEOUT on a timeout', async () => {
        const down = directory(
            {
                bind: () => {
                    throw new Error('connect ECONNREFUSED');
                },
            },
            { url: ['ldap://dc1', 'ldap://dc2'] },
        );
        const error = await down.ldap.findUser('ana').catch((e: unknown) => e);
        expect(error).toBeInstanceOf(LdapError);
        expect(error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', context: { urls: ['ldap://dc1', 'ldap://dc2'] } });

        const slow = directory({
            search: () => {
                throw new LdapTimeoutError('SearchRequest: Operation timed out');
            },
        });
        expect(await slow.ldap.findUser('ana').catch((e: unknown) => e)).toMatchObject({ code: 'TIMEOUT' });
    });

    it('reports a refused service account as a config error, not as a wrong password', async () => {
        const { ldap } = directory({
            bind: (dn) => {
                if (dn === 'svc@corp.example.com') throw invalidCredentials();
            },
        });
        const error = await ldap.authenticate('ana', 'secret').catch((e: unknown) => e);
        expect(error).toMatchObject({ code: 'CONFIG_INVALID', resultCode: 49 });
    });

    it('needs a service password (an empty one binds anonymously)', () => {
        expect(() => new LdapDirectory({ ...AD_CONFIG, bindPassword: '' })).toThrow('bindPassword');
    });

    it('turns a health check error into status error, without the credentials', async () => {
        const { ldap } = directory({
            bind: () => {
                throw new Error('connect ECONNREFUSED');
            },
        });
        const check = await ldap.healthCheck()();
        expect(check.status).toBe('error');
        expect(check.message).not.toContain('svc-pass');
        const ok = await directory({}).ldap.healthCheck()();
        expect(ok).toMatchObject({ status: 'ok', details: { url: 'ldap://dc1' } });
    });
});

describe('LdapDirectory.changesSince', () => {
    it('searches after a USN and returns the next one, taken before the search', async () => {
        const { ldap, calls } = directory({
            search: (base) =>
                base === ''
                    ? [entry('', { highestCommittedUSN: ['5000'] })]
                    : [entry('CN=a', { uSNChanged: ['4100'] }), entry('CN=b', { uSNChanged: ['4200'] })],
        });
        const result = await ldap.changesSince({ usn: 4000 });

        expect(result.entries.map((e) => e.dn)).toEqual(['CN=a', 'CN=b']);
        expect(result.next).toEqual({ usn: 5000n });
        expect(calls.find((c) => c.base === AD_CONFIG.baseDN)!.search!.filter).toBe(
            '(&(&(objectCategory=person)(objectClass=user))(uSNChanged>=4001))',
        );
    });

    it('searches by date with whenChanged in AD', async () => {
        const { ldap, calls } = directory({});
        const result = await ldap.changesSince(
            { date: new Date(Date.UTC(2024, 5, 1)) },
            { filter: '(objectClass=group)' },
        );
        expect('date' in result.next).toBe(true);
        expect(calls.find((c) => c.op === 'search')!.search!.filter).toBe(
            '(&(objectClass=group)(whenChanged>=20240601000000.0Z))',
        );
    });
});

describe('LdapDirectory secrets', () => {
    it('does not show the service password when logged or serialized', () => {
        const ldap = new LdapDirectory(AD_CONFIG);
        expect(JSON.stringify(ldap)).not.toContain('svc-pass');
        expect(Bun.inspect(ldap)).not.toContain('svc-pass');
    });
});
