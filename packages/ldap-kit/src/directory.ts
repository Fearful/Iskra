import type { ConnectionOptions } from 'node:tls';
import { ConfigError, ErrorCodes } from '@iskra-bun/core';
import { decodeAccountControl } from './decode';
import { LdapEntry } from './entry';
import { LdapError } from './errors';
import { escapeFilterValue, generalizedTime } from './filter';
import {
    LdapResultError,
    LdapTimeoutError,
    ldaptsTransport,
    type LdapTransport,
    type LdapTransportFactory,
    type TransportSearch,
} from './transport';

/** Which directory it is: the default filters and attributes follow it. */
export type DirectoryKind = 'activeDirectory' | 'openldap';

export interface LdapConfig {
    /** `ldaps://dc1.corp.example.com:636`, or several, tried in order when one cannot be reached. */
    url: string | readonly string[];
    /** Where users and groups are searched: `DC=corp,DC=example,DC=com`. */
    baseDN: string;
    /** The service account that searches: a DN, or in Active Directory a UPN (`svc-app@corp.example.com`). */
    bindDN: string;
    bindPassword: string;
    /** Default `'activeDirectory'`. */
    directory?: DirectoryKind;
    /** Upgrades `ldap://` connections with StartTLS. */
    startTLS?: boolean;
    /** For `ldaps://` and StartTLS: `ca` (the directory's CA), `servername`… */
    tls?: ConnectionOptions;
    /** Default 5000. */
    connectTimeoutMs?: number;
    /** Each operation's limit, after which its connection is closed. Default 10000. */
    timeoutMs?: number;
    /** Entries per page of a search (the paged results control). Default 500. */
    pageSize?: number;
    users?: {
        /** Default `baseDN`. */
        base?: string;
        /**
         * The filter that finds a user by login; `{login}` is the login,
         * escaped. Default in AD: by `sAMAccountName` or `userPrincipalName`
         * (a `DOMAIN\user` login is taken as `user`); in OpenLDAP by `uid`.
         */
        filter?: string;
        /** Attributes to read besides the defaults (`employeeID`, `department`…). */
        attributes?: readonly string[];
        /** Of those, the binary ones (read as bytes). */
        binaryAttributes?: readonly string[];
    };
    groups?: {
        /** Default `baseDN`. */
        base?: string;
    };
    /** How connections are made: ldapts by default. */
    transport?: LdapTransportFactory;
}

/** A user of the directory. */
export interface LdapUser {
    dn: string;
    /** `sAMAccountName` (AD) or `uid` (OpenLDAP). */
    username: string;
    userPrincipalName?: string;
    displayName?: string;
    email?: string;
    givenName?: string;
    surname?: string;
    /** `objectGUID` (AD) or `entryUUID` (OpenLDAP): it does not change when the user is renamed or moved. */
    id?: string;
    /** `objectSid` (AD). */
    sid?: string;
    /** The DNs of the groups it is a direct member of (`memberOf`). */
    memberOf: string[];
    /** userAccountControl's ACCOUNTDISABLE (AD). */
    disabled: boolean;
    /** A `lockoutTime` (AD) or a `pwdAccountLockedTime` (OpenLDAP's ppolicy). */
    locked: boolean;
    /** `accountExpires` (AD); null when it never expires. */
    expiresAt: Date | null;
    /** With `authenticate(…, { groups })`: its groups. */
    groups?: LdapGroup[];
    /** Every attribute read. */
    entry: LdapEntry;
}

export interface LdapGroup {
    dn: string;
    /** Its `cn`. */
    name: string;
    /** `objectGUID` (AD) or `entryUUID` (OpenLDAP). */
    id?: string;
    sid?: string;
    entry: LdapEntry;
}

/**
 * Why a login failed, for logs and metrics. Never tell the client which
 * one: it tells an attacker which accounts exist.
 */
export type AuthFailure =
    | 'empty_password'
    | 'user_not_found'
    | 'ambiguous_user'
    | 'invalid_credentials'
    | 'account_disabled'
    | 'account_locked'
    | 'account_expired'
    | 'password_expired'
    | 'password_must_change'
    | 'logon_not_permitted';

export type AuthResult = { ok: true; user: LdapUser } | { ok: false; reason: AuthFailure };

export interface SearchOptions {
    /** Default `baseDN`. */
    base?: string;
    /** Default `'sub'`. */
    scope?: 'base' | 'one' | 'sub';
    /** Default `(objectClass=*)`. Build it with `ldapFilter` to escape values. */
    filter?: string;
    /** Default: every user attribute. */
    attributes?: readonly string[];
    /** Attributes read as bytes. Default `objectGUID` and `objectSid`. */
    binaryAttributes?: readonly string[];
    /** Entries per page; `false` for one request without paging. Default `pageSize` (500). */
    pageSize?: number | false;
    /** At most this many entries. */
    sizeLimit?: number;
}

/** Where `changesSince()` starts: an Active Directory USN, or a date. */
export type ChangeMark = { usn: bigint | number | string } | { date: Date };

export interface ChangesResult {
    entries: LdapEntry[];
    /** Where the next call starts: nothing changed after it was taken is missed. */
    next: { usn: bigint } | { date: Date };
}

interface Flavor {
    userFilter: string;
    userObjects: string;
    userAttributes: string[];
    username: string;
    groupObjects: string;
    groupAttributes: string[];
    /** The groups `dn` (escaped) is a direct member of. */
    member(dn: string): string;
    /** The groups `dn` is a member of, through nested groups too, in one search. */
    nested?(dn: string): string;
    changed: string;
}

const ACTIVE_DIRECTORY: Flavor = {
    userFilter: '(&(objectCategory=person)(objectClass=user)(|(sAMAccountName={login})(userPrincipalName={login})))',
    userObjects: '(&(objectCategory=person)(objectClass=user))',
    userAttributes: [
        'sAMAccountName',
        'userPrincipalName',
        'displayName',
        'cn',
        'mail',
        'givenName',
        'sn',
        'objectGUID',
        'objectSid',
        'memberOf',
        'userAccountControl',
        'lockoutTime',
        'accountExpires',
        'pwdLastSet',
        'whenChanged',
        'uSNChanged',
    ],
    username: 'sAMAccountName',
    groupObjects: '(objectClass=group)',
    groupAttributes: ['cn', 'description', 'objectGUID', 'objectSid'],
    member: (dn) => `(member=${dn})`,
    // LDAP_MATCHING_RULE_IN_CHAIN: the server walks the nested groups.
    nested: (dn) => `(member:1.2.840.113556.1.4.1941:=${dn})`,
    changed: 'whenChanged',
};

const OPENLDAP: Flavor = {
    userFilter: '(&(objectClass=person)(uid={login}))',
    userObjects: '(objectClass=person)',
    userAttributes: [
        'uid',
        'cn',
        'displayName',
        'mail',
        'givenName',
        'sn',
        'memberOf',
        'entryUUID',
        'modifyTimestamp',
        'pwdAccountLockedTime',
    ],
    username: 'uid',
    groupObjects: '(|(objectClass=groupOfNames)(objectClass=groupOfUniqueNames))',
    groupAttributes: ['cn', 'description', 'entryUUID'],
    member: (dn) => `(|(member=${dn})(uniqueMember=${dn}))`,
    changed: 'modifyTimestamp',
};

const BINARY = ['objectGUID', 'objectSid'];

/** How deep `groupsOf()` follows nested groups where the server cannot. */
const MAX_NESTING = 16;

/** Active Directory's reason for a refused bind: the `data` of its message. */
const AD_REASONS: Record<string, AuthFailure> = {
    '525': 'user_not_found',
    '52e': 'invalid_credentials',
    '530': 'logon_not_permitted',
    '531': 'logon_not_permitted',
    '532': 'password_expired',
    '533': 'account_disabled',
    '568': 'logon_not_permitted',
    '701': 'account_expired',
    '773': 'password_must_change',
    '775': 'account_locked',
};

function refusal(message: string): AuthFailure {
    const data = /\bdata ([0-9a-f]{3,4})\b/i.exec(message)?.[1]?.toLowerCase();
    return (data && AD_REASONS[data]) || 'invalid_credentials';
}

function compact<T extends object>(value: T): T {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/**
 * An LDAP directory, Active Directory by default: logins, users, their
 * groups (nested included) and what changed. Every call opens a connection,
 * binds as the service account and closes it when done.
 *
 * ```ts
 * const ldap = new LdapDirectory({
 *     url: 'ldaps://dc1.corp.example.com',
 *     baseDN: 'DC=corp,DC=example,DC=com',
 *     bindDN: 'svc-app@corp.example.com',
 *     bindPassword: process.env.LDAP_PASSWORD!,
 * });
 * const result = await ldap.authenticate(login, password, { groups: 'nested' });
 * if (!result.ok) logger.warn('login refused', { reason: result.reason });
 * ```
 */
export class LdapDirectory {
    private readonly urls: string[];
    private readonly flavor: Flavor;
    /** A private field: logging the directory does not print `bindPassword`. */
    readonly #config: LdapConfig;

    constructor(config: LdapConfig) {
        this.#config = config;
        this.urls = typeof config.url === 'string' ? [config.url] : [...config.url];
        if (this.urls.length === 0) throw new ConfigError('LdapDirectory: `url` is empty');
        if (!config.baseDN) throw new ConfigError('LdapDirectory: `baseDN` is empty');
        // An empty password is an anonymous bind, which servers accept.
        if (!config.bindDN || !config.bindPassword) {
            throw new ConfigError('LdapDirectory: `bindDN` and `bindPassword` are required');
        }
        this.flavor = config.directory === 'openldap' ? OPENLDAP : ACTIVE_DIRECTORY;
    }

    /**
     * Checks a login: finds the user with the service account (exactly one
     * match), then binds as that user with `password`. A refused login is
     * `{ ok: false, reason }`; an unreachable directory throws `LdapError`.
     * An empty password is refused without asking the server.
     */
    async authenticate(
        login: string,
        password: string,
        options: { groups?: 'direct' | 'nested' | false } = {},
    ): Promise<AuthResult> {
        if (typeof password !== 'string' || password.length === 0) return { ok: false, reason: 'empty_password' };
        if (typeof login !== 'string' || login.trim() === '') return { ok: false, reason: 'user_not_found' };
        return this.session(async (t) => {
            const found = await this.usersByLogin(t, login);
            if (found.length === 0) return { ok: false, reason: 'user_not_found' };
            if (found.length > 1) return { ok: false, reason: 'ambiguous_user' };
            const user = this.toUser(found[0]!);
            try {
                await t.bind(user.dn, password);
            } catch (error) {
                if (error instanceof LdapResultError && error.resultCode === 49) {
                    return { ok: false, reason: refusal(error.message) };
                }
                throw error;
            }
            if (!options.groups) return { ok: true, user };
            // Back to the service account: the user may not read the groups.
            await this.bindService(t);
            return {
                ok: true,
                user: { ...user, groups: await this.groupsOn(t, user.dn, options.groups === 'nested') },
            };
        });
    }

    /** The user with this login (as `authenticate` finds it), or null when there is none or more than one. */
    async findUser(login: string): Promise<LdapUser | null> {
        if (login.trim() === '') return null;
        const found = await this.session((t) => this.usersByLogin(t, login));
        return found.length === 1 ? this.toUser(found[0]!) : null;
    }

    /** The user at this DN, or null. */
    async findUserByDN(dn: string): Promise<LdapUser | null> {
        const entries = await this.session(async (t) => {
            try {
                return await this.collect(t, dn, {
                    scope: 'base',
                    filter: this.flavor.userObjects,
                    attributes: this.userAttributes(),
                    binaryAttributes: this.binaryAttributes(),
                });
            } catch (error) {
                if (error instanceof LdapResultError && error.resultCode === 32) return [];
                throw error;
            }
        });
        return entries[0] ? this.toUser(entries[0]) : null;
    }

    /**
     * The groups of a user (or of any member, by DN): with `nested` (the
     * default) also the groups those groups are in. AD resolves them in one
     * search; elsewhere they are followed level by level.
     */
    async groupsOf(member: LdapUser | string, options: { nested?: boolean } = {}): Promise<LdapGroup[]> {
        const dn = typeof member === 'string' ? member : member.dn;
        return this.session((t) => this.groupsOn(t, dn, options.nested ?? true));
    }

    /** Every entry a search finds, all pages. */
    async search(options: SearchOptions = {}): Promise<LdapEntry[]> {
        const entries: LdapEntry[] = [];
        for await (const page of this.searchPages(options)) entries.push(...page);
        return entries;
    }

    /** A search page by page, on one connection, closed when the iteration ends. */
    async *searchPages(options: SearchOptions = {}): AsyncGenerator<LdapEntry[]> {
        const t = await this.open();
        try {
            const pageSize = options.pageSize === false ? undefined : (options.pageSize ?? this.pageSize());
            const pages = t.search(options.base ?? this.#config.baseDN, {
                scope: options.scope ?? 'sub',
                filter: options.filter ?? '(objectClass=*)',
                attributes: options.attributes ?? [],
                binaryAttributes: options.binaryAttributes ?? BINARY,
                ...(pageSize ? { pageSize } : {}),
                ...(options.sizeLimit ? { sizeLimit: options.sizeLimit } : {}),
            });
            for await (const page of pages) yield page.map((e) => new LdapEntry(e));
        } catch (error) {
            throw this.failure(error);
        } finally {
            await t.close();
        }
    }

    /**
     * The users (or, with `filter`, other objects) changed since `mark`,
     * and the mark of the next call. In AD prefer a USN (`uSNChanged`),
     * which is per domain controller: read changes from one `url`. A date
     * compares `whenChanged` (AD) or `modifyTimestamp` (OpenLDAP) with the
     * app's clock. Deleted objects are not returned.
     */
    async changesSince(
        mark: ChangeMark,
        options: { filter?: string; attributes?: readonly string[] } = {},
    ): Promise<ChangesResult> {
        const objects = options.filter ?? this.flavor.userObjects;
        const attributes = options.attributes ?? (options.filter ? [] : this.userAttributes());
        if ('usn' in mark) {
            if (this.flavor !== ACTIVE_DIRECTORY) throw new ConfigError('changesSince({ usn }) needs Active Directory');
            const from = BigInt(mark.usn) + 1n;
            return this.session(async (t) => {
                // Taken before the search: a change made meanwhile comes again next time, never lost.
                const [root] = await this.collect(t, '', {
                    scope: 'base',
                    filter: '(objectClass=*)',
                    attributes: ['highestCommittedUSN'],
                    binaryAttributes: [],
                });
                const highest = root ? new LdapEntry(root).bigint('highestCommittedUSN') : undefined;
                const entries = await this.collect(t, this.#config.baseDN, {
                    scope: 'sub',
                    filter: `(&${objects}(uSNChanged>=${from}))`,
                    attributes: [...attributes, ...(attributes.length > 0 ? ['uSNChanged'] : [])],
                    binaryAttributes: this.binaryAttributes(),
                    pageSize: this.pageSize(),
                });
                const seen = entries.map((e) => new LdapEntry(e));
                const last = seen.reduce((max, e) => {
                    const usn = e.bigint('uSNChanged') ?? 0n;
                    return usn > max ? usn : max;
                }, from - 1n);
                return { entries: seen, next: { usn: highest !== undefined && highest > last ? highest : last } };
            });
        }
        const started = new Date();
        const entries = await this.search({
            filter: `(&${objects}(${this.flavor.changed}>=${generalizedTime(mark.date)}))`,
            attributes: attributes.length > 0 ? [...attributes, this.flavor.changed] : [],
            binaryAttributes: this.binaryAttributes(),
        });
        return { entries, next: { date: started } };
    }

    /** Connects, binds as the service account and reads the root DSE: what a health check needs. */
    async ping(): Promise<{ url: string; latencyMs: number; rootDSE: LdapEntry }> {
        const started = performance.now();
        const { t, url } = await this.openWithUrl();
        try {
            const [root] = await this.collect(t, '', {
                scope: 'base',
                filter: '(objectClass=*)',
                attributes: [
                    'namingContexts',
                    'defaultNamingContext',
                    'dnsHostName',
                    'vendorName',
                    'supportedLDAPVersion',
                ],
                binaryAttributes: [],
            });
            return {
                url,
                latencyMs: Math.round(performance.now() - started),
                rootDSE: new LdapEntry(root ?? { dn: '', attributes: {} }),
            };
        } catch (error) {
            throw this.failure(error);
        } finally {
            await t.close();
        }
    }

    /**
     * A check for web-kit's HealthCheckFeature (`checks: { ldap: ldap.healthCheck() }`):
     * `ok` with the latency, `error` with what failed (not the credentials).
     */
    healthCheck(): () => Promise<{ status: 'ok' | 'error'; message?: string; details?: unknown }> {
        return async () => {
            try {
                const { url, latencyMs } = await this.ping();
                return { status: 'ok', details: { url, latencyMs } };
            } catch (error) {
                return { status: 'error', message: error instanceof Error ? error.message : 'LDAP unreachable' };
            }
        };
    }

    // ─── Internals ───────────────────────────────────────────────────────────

    private pageSize(): number {
        return this.#config.pageSize ?? 500;
    }

    private userAttributes(): string[] {
        return [...new Set([...this.flavor.userAttributes, ...(this.#config.users?.attributes ?? [])])];
    }

    private binaryAttributes(): string[] {
        return [...new Set([...BINARY, ...(this.#config.users?.binaryAttributes ?? [])])];
    }

    /** A login as AD knows it: `DOMAIN\user` is `user`. */
    private loginOf(login: string): string {
        const trimmed = login.trim();
        return this.flavor === ACTIVE_DIRECTORY && trimmed.includes('\\')
            ? trimmed.slice(trimmed.indexOf('\\') + 1)
            : trimmed;
    }

    private async usersByLogin(t: LdapTransport, login: string) {
        const filter = (this.#config.users?.filter ?? this.flavor.userFilter).replaceAll(
            '{login}',
            escapeFilterValue(this.loginOf(login)),
        );
        return this.collect(t, this.#config.users?.base ?? this.#config.baseDN, {
            scope: 'sub',
            filter,
            attributes: this.userAttributes(),
            binaryAttributes: this.binaryAttributes(),
            pageSize: this.pageSize(),
        });
    }

    private async groupsOn(t: LdapTransport, dn: string, nested: boolean): Promise<LdapGroup[]> {
        const base = this.#config.groups?.base ?? this.#config.baseDN;
        const search = (filter: string) =>
            this.collect(t, base, {
                scope: 'sub',
                filter: `(&${this.flavor.groupObjects}${filter})`,
                attributes: this.flavor.groupAttributes,
                binaryAttributes: BINARY,
                pageSize: this.pageSize(),
            });
        const escaped = escapeFilterValue(dn);
        if (!nested || this.flavor.nested) {
            const filter = nested ? this.flavor.nested!(escaped) : this.flavor.member(escaped);
            return (await search(filter)).map((e) => this.toGroup(new LdapEntry(e)));
        }
        // Level by level: the groups of the member, then the groups of those.
        const found = new Map<string, LdapGroup>();
        let frontier = [dn];
        for (let depth = 0; depth < MAX_NESTING && frontier.length > 0; depth++) {
            const filter = `(|${frontier.map((member) => this.flavor.member(escapeFilterValue(member))).join('')})`;
            frontier = [];
            for (const entry of await search(filter)) {
                const key = entry.dn.toLowerCase();
                if (found.has(key)) continue;
                found.set(key, this.toGroup(new LdapEntry(entry)));
                frontier.push(entry.dn);
            }
        }
        return [...found.values()];
    }

    private toUser(raw: { dn: string; attributes: Record<string, Array<string | Uint8Array>> }): LdapUser {
        const entry = new LdapEntry(raw);
        const control = entry.number('userAccountControl');
        const lockout = entry.bigint('lockoutTime');
        return compact({
            dn: entry.dn,
            username: entry.get(this.flavor.username) ?? entry.get('cn') ?? entry.dn,
            userPrincipalName: entry.get('userPrincipalName'),
            displayName: entry.get('displayName') ?? entry.get('cn'),
            email: entry.get('mail'),
            givenName: entry.get('givenName'),
            surname: entry.get('sn'),
            id: entry.guid() ?? entry.get('entryUUID'),
            sid: entry.sid(),
            memberOf: entry.getAll('memberOf'),
            disabled: control !== undefined && decodeAccountControl(control).disabled,
            locked: (lockout !== undefined && lockout > 0n) || entry.has('pwdAccountLockedTime'),
            expiresAt: entry.date('accountExpires') ?? null,
            entry,
        });
    }

    private toGroup(entry: LdapEntry): LdapGroup {
        return compact({
            dn: entry.dn,
            name: entry.get('cn') ?? entry.dn,
            id: entry.guid() ?? entry.get('entryUUID'),
            sid: entry.sid(),
            entry,
        });
    }

    private async collect(t: LdapTransport, base: string, search: TransportSearch) {
        const entries = [];
        for await (const page of t.search(base, search)) entries.push(...page);
        return entries;
    }

    private async bindService(t: LdapTransport): Promise<void> {
        try {
            await t.bind(this.#config.bindDN, this.#config.bindPassword);
        } catch (error) {
            if (error instanceof LdapResultError && error.resultCode === 49) {
                throw new LdapError('The directory refused the service account (bindDN, bindPassword)', {
                    code: ErrorCodes.CONFIG_INVALID,
                    cause: error,
                    context: { resultCode: 49 },
                });
            }
            throw error;
        }
    }

    private async open(): Promise<LdapTransport> {
        return (await this.openWithUrl()).t;
    }

    /** A connection bound as the service account, to the first `url` that answers. */
    private async openWithUrl(): Promise<{ t: LdapTransport; url: string }> {
        const factory = this.#config.transport ?? ldaptsTransport;
        let last: unknown;
        for (const url of this.urls) {
            let t: LdapTransport | undefined;
            try {
                t = await factory({
                    url,
                    startTLS: this.#config.startTLS ?? false,
                    ...(this.#config.tls ? { tls: this.#config.tls } : {}),
                    connectTimeoutMs: this.#config.connectTimeoutMs ?? 5000,
                    timeoutMs: this.#config.timeoutMs ?? 10_000,
                });
                await this.bindService(t);
                return { t, url };
            } catch (error) {
                await t?.close();
                // The server answered: another one would answer the same.
                if (error instanceof LdapError || error instanceof LdapResultError) throw this.failure(error);
                last = error;
            }
        }
        throw this.failure(last, { urls: this.urls });
    }

    /** Runs `fn` on a connection bound as the service account, and closes it. */
    private async session<T>(fn: (t: LdapTransport) => Promise<T>): Promise<T> {
        const t = await this.open();
        try {
            return await fn(t);
        } catch (error) {
            throw this.failure(error);
        } finally {
            await t.close();
        }
    }

    private failure(error: unknown, context: Record<string, unknown> = {}): LdapError {
        if (error instanceof LdapError) return error;
        const cause = error instanceof Error ? error : undefined;
        if (error instanceof LdapTimeoutError) {
            return new LdapError(`LDAP timed out: ${error.message}`, { code: ErrorCodes.TIMEOUT, cause, context });
        }
        if (error instanceof LdapResultError) {
            return new LdapError(`LDAP error ${error.resultCode}: ${error.message}`, {
                cause,
                context: { ...context, resultCode: error.resultCode },
            });
        }
        return new LdapError(`LDAP unreachable: ${cause?.message ?? String(error)}`, {
            code: ErrorCodes.SERVICE_UNAVAILABLE,
            cause,
            context,
        });
    }
}
