/**
 * `@iskra-bun/ldap-kit/web`: a web-kit gate that checks a login and
 * password against the directory.
 */
import type { Context } from 'hono';
import { AuthError, type Actor, type Gate } from '@iskra-bun/web-kit';
import type { LdapDirectory, LdapUser } from './directory';

/** A directory user's actor by default. */
export interface LdapActor extends Actor {
    kind: 'user';
    /** The username (`sAMAccountName`, `uid`). */
    id: string;
    dn: string;
    /** `objectGUID` or `entryUUID`: stable across renames. */
    guid?: string;
    email?: string;
    displayName?: string;
    /** The names (`cn`) of its groups, with the `groups` option. */
    groups?: string[];
}

export interface LdapPasswordOptions<A extends Actor> {
    /**
     * The login and password of a request, or null when it carries none
     * (another gate may take it). Default: HTTP Basic auth.
     */
    credentials?: (
        c: Context,
    ) => { login: string; password: string } | null | Promise<{ login: string; password: string } | null>;
    /** Read the user's groups too: `'direct'` or `'nested'`. */
    groups?: 'direct' | 'nested';
    /** The actor from the user. Default: `LdapActor`. */
    toActor?: (user: LdapUser, c: Context) => A | Promise<A>;
    /** The realm of the Basic challenge. Default `'api'`. */
    realm?: string;
}

/** `Authorization: Basic base64(login:password)`. */
function basicCredentials(c: Context): { login: string; password: string } | null {
    const match = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(c.req.header('Authorization') ?? '');
    if (!match) return null;
    const decoded = Buffer.from(match[1]!, 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    if (colon < 0) return null;
    return { login: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

function ldapActor(user: LdapUser): LdapActor {
    return {
        kind: 'user',
        id: user.username,
        dn: user.dn,
        ...(user.id ? { guid: user.id } : {}),
        ...(user.email ? { email: user.email } : {}),
        ...(user.displayName ? { displayName: user.displayName } : {}),
        ...(user.groups ? { groups: user.groups.map((g) => g.name) } : {}),
    };
}

/**
 * A gate that checks a request's login and password (Basic auth by
 * default) with `ldap.authenticate()`. Every refusal is the same 401,
 * whatever the reason (the reason would tell which accounts exist); an
 * unreachable directory is its `LdapError` (503). Put a rate limit on the
 * routes it guards: each attempt is a bind against the directory, and
 * Active Directory locks accounts after its failed-attempt threshold.
 *
 * ```ts
 * app.get('/me', requireActor(anyOf(jwt({ jwksUri }), ldapPassword(ldap, { groups: 'nested' }))), (c) => …);
 * ```
 */
export function ldapPassword<A extends Actor = LdapActor>(
    ldap: LdapDirectory,
    options: LdapPasswordOptions<A> = {},
): Gate<A> {
    const challenge = `Basic realm="${(options.realm ?? 'api').replace(/["\\]/g, '')}", charset="UTF-8"`;
    const credentials = options.credentials ?? basicCredentials;
    const toActor = options.toActor ?? ((user: LdapUser) => ldapActor(user) as unknown as A);
    const check = async (c: Context): Promise<A | null> => {
        const given = await credentials(c);
        if (!given) return null;
        const result = await ldap.authenticate(given.login, given.password, { groups: options.groups ?? false });
        if (!result.ok) {
            throw new AuthError('Invalid credentials', { headers: { 'WWW-Authenticate': challenge } });
        }
        return toActor(result.user, c);
    };
    return Object.assign(
        check,
        options.credentials
            ? {}
            : {
                  challenge,
                  openapi: [[{ name: 'basic', scheme: { type: 'http' as const, scheme: 'basic' } }]],
              },
    );
}
