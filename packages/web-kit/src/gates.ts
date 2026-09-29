import { createHash } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { Jwt } from 'hono/utils/jwt';
import { AuthError, ForbiddenError, HttpError } from './errors';

/**
 * Who made a request, as a gate proved it: a user, an API key, a service.
 * Gates may return more fields (a JWT's claims, a key's name).
 */
export interface Actor {
    /** What proved it: `'user'`, `'apiKey'`, `'service'`… */
    kind: string;
    id: string;
    scopes?: readonly string[];
}

/**
 * Declares the app's actor type for `c.get('actor')` / `c.var.actor`:
 *
 * ```ts
 * declare module '@iskra-bun/web-kit' {
 *     interface ActorRegistry {
 *         actor: MyActor;
 *     }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- filled by declaration merging
export interface ActorRegistry {}

/** The app's actor type: the one in `ActorRegistry`, else `Actor`. */
export type AppActor = ActorRegistry extends { actor: infer A } ? A : Actor;

declare module 'hono' {
    interface ContextVariableMap {
        /** Set by `requireActor()` or `identify()`: who made the request. */
        actor?: AppActor;
    }
}

/**
 * Proves who made a request: returns the actor, `null` when the request does
 * not carry this gate's credential (another gate may take it), or throws a
 * 401 `AuthError` when it carries one that is not valid.
 */
export interface Gate<A extends Actor = Actor> {
    (c: Context): Promise<A | null | undefined> | A | null | undefined;
    /** The `WWW-Authenticate` challenge of a 401 when no credential came (`Bearer`). */
    challenge?: string;
}

type ActorOf<G> = G extends Gate<infer A> ? A : never;

function gate<A extends Actor>(check: (c: Context) => Promise<A | null>, challenge?: string): Gate<A> {
    return Object.assign(check, challenge ? { challenge } : {});
}

/** The token of `Authorization: Bearer <token>`. */
function bearerToken(c: Context): string | undefined {
    return /^Bearer\s+(\S+)\s*$/i.exec(c.req.header('Authorization') ?? '')?.[1];
}

const invalidToken = (message: string) =>
    new AuthError(message, { headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' } });

/**
 * A bearer token checked by `verify`, which returns the actor or null for a
 * token it does not accept (a 401 `invalid_token`).
 */
export function bearer<A extends Actor>(
    verify: (token: string, c: Context) => Promise<A | null | undefined> | A | null | undefined,
): Gate<A> {
    return gate(async (c) => {
        const token = bearerToken(c);
        if (!token) return null;
        const actor = await verify(token, c);
        if (!actor) throw invalidToken('Invalid token');
        return actor;
    }, 'Bearer');
}

/** The claims of a verified JWT. */
export type JwtClaims = Awaited<ReturnType<typeof Jwt.verify>>;

/** A JWT's actor by default: its subject, and its scopes from `scope` or `scp`. */
export interface JwtActor extends Actor {
    claims: JwtClaims;
}

export interface JwtGateOptions<A extends Actor> {
    /** The key of tokens signed with one key: an HMAC secret, or a public key. */
    secret?: string;
    /** Or the keys of an identity provider: its JWKS URL (they are fetched and cached by Hono). */
    jwksUri?: string;
    /** Algorithms accepted. Default `['HS256']` with `secret`, `['RS256']` with `jwksUri`. */
    algorithms?: string[];
    /** The `iss` a token must have. */
    issuer?: string;
    /** The `aud` a token must have (one of them). */
    audience?: string | string[];
    /** The actor from the claims; null refuses the token. Default: `{ kind: 'user', id: sub, scopes, claims }`. */
    toActor?: (claims: JwtClaims, c: Context) => A | null | Promise<A | null>;
}

function jwtActor(claims: JwtClaims): JwtActor | null {
    if (claims.sub === undefined) return null;
    const scope = claims.scope ?? claims.scp;
    const scopes =
        typeof scope === 'string' ? scope.split(' ').filter(Boolean) : Array.isArray(scope) ? scope : undefined;
    return { kind: 'user', id: String(claims.sub), ...(scopes ? { scopes: scopes.map(String) } : {}), claims };
}

/**
 * A JWT in `Authorization: Bearer`, verified with Hono's JWT utilities (no
 * other dependency): signature, `exp`/`nbf`, and the issuer and audience given.
 */
export function jwt<A extends Actor = JwtActor>(options: JwtGateOptions<A>): Gate<A> {
    if (!options.secret === !options.jwksUri) throw new Error('jwt() takes either `secret` or `jwksUri`');
    const verification = {
        ...(options.issuer ? { iss: options.issuer } : {}),
        ...(options.audience ? { aud: options.audience } : {}),
    };
    const toActor = options.toActor ?? ((claims: JwtClaims) => jwtActor(claims) as A | null);
    return gate(async (c) => {
        const token = bearerToken(c);
        if (!token) return null;
        let claims: JwtClaims;
        try {
            claims = options.secret
                ? await Jwt.verify(token, options.secret, {
                      alg: (options.algorithms?.[0] ?? 'HS256') as 'HS256',
                      ...verification,
                  })
                : await Jwt.verifyWithJwks(token, {
                      jwks_uri: options.jwksUri,
                      allowedAlgorithms: (options.algorithms ?? ['RS256']) as ['RS256'],
                      verification,
                  });
        } catch {
            throw invalidToken('Invalid token');
        }
        const actor = await toActor(claims, c);
        if (!actor) throw invalidToken('Invalid token');
        return actor;
    }, 'Bearer');
}

/** An API key as a store knows it. */
export interface ApiKeyRecord {
    /** Names the key (never the key itself): the actor's id. */
    id: string;
    name?: string;
    scopes?: readonly string[];
    expiresAt?: Date | null;
    metadata?: Record<string, unknown>;
}

/** Where API keys live: `staticKeys()`, `hashedKeys()` over a table, or your own. */
export interface KeyStore {
    find(key: string): Promise<ApiKeyRecord | null | undefined> | ApiKeyRecord | null | undefined;
}

/** A key's SHA-256, in hex: what to store instead of the key (see `hashedKeys`). */
export function hashApiKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
}

/**
 * Keys from the config. They are held by their hash, so looking one up does
 * not compare the key itself character by character.
 */
export function staticKeys(keys: ReadonlyArray<{ key: string; id?: string } & Omit<ApiKeyRecord, 'id'>>): KeyStore {
    const byHash = new Map(
        keys.map(({ key, ...record }, i) => [
            hashApiKey(key),
            { ...record, id: record.id ?? record.name ?? `key-${i + 1}` },
        ]),
    );
    return { find: (key) => byHash.get(hashApiKey(key)) };
}

/**
 * Keys stored by their SHA-256 (`hashApiKey(key)`), as a database table
 * holds them: `lookup` gets the hash of the key the request sent.
 *
 * ```ts
 * hashedKeys((hash) => db.queryOne('SELECT id, scopes FROM api_keys WHERE key_hash = :hash', { hash }))
 * ```
 */
export function hashedKeys(
    lookup: (hash: string) => Promise<ApiKeyRecord | null | undefined> | ApiKeyRecord | null | undefined,
): KeyStore {
    return { find: (key) => lookup(hashApiKey(key)) };
}

/** A key's actor by default. */
export interface ApiKeyActor extends Actor {
    kind: 'apiKey';
    name?: string;
    metadata?: Record<string, unknown>;
}

export interface ApiKeyGateOptions<A extends Actor> {
    /** The header that carries the key. Default `X-API-Key`; `false` for none. */
    header?: string | false;
    /** Also take the key from `Authorization: Bearer`. Default false. */
    bearer?: boolean;
    /** Also take the key from this query parameter (it ends up in access logs). */
    query?: string;
    /** The actor from the record. Default: `{ kind: 'apiKey', id, name, scopes, metadata }`. */
    toActor?: (record: ApiKeyRecord, c: Context) => A;
}

/** An API key found in `store`; an unknown or expired key is a 401. */
export function apiKey<A extends Actor = ApiKeyActor>(store: KeyStore, options: ApiKeyGateOptions<A> = {}): Gate<A> {
    const header = options.header === undefined ? 'X-API-Key' : options.header;
    const toActor =
        options.toActor ??
        ((record: ApiKeyRecord) =>
            ({
                kind: 'apiKey',
                id: record.id,
                ...(record.name ? { name: record.name } : {}),
                ...(record.scopes ? { scopes: record.scopes } : {}),
                ...(record.metadata ? { metadata: record.metadata } : {}),
            }) as unknown as A);
    return gate(
        async (c) => {
            const key =
                (header ? c.req.header(header) : undefined) ??
                (options.bearer ? bearerToken(c) : undefined) ??
                (options.query ? c.req.query(options.query) : undefined);
            if (!key) return null;
            const record = await store.find(key);
            if (!record) throw new AuthError('Invalid API key');
            if (record.expiresAt && record.expiresAt.getTime() <= Date.now())
                throw new AuthError('API key has expired');
            return toActor(record, c);
        },
        options.bearer ? 'Bearer' : undefined,
    );
}

/** A session user's actor by default. */
export interface UserActor extends Actor {
    kind: 'user';
    email?: string;
    user: unknown;
}

/**
 * The user of a session, as `AuthFeature` (better-auth) puts it in
 * `c.get('user')`: null when there is none.
 */
export function session<A extends Actor = UserActor>(
    options: { toActor?: (user: { id: string; email?: string }, c: Context) => A } = {},
): Gate<A> {
    return gate(async (c) => {
        const user = c.get('user' as never) as { id: string; email?: string } | null | undefined;
        if (!user) return null;
        if (options.toActor) return options.toActor(user, c);
        return { kind: 'user', id: user.id, ...(user.email ? { email: user.email } : {}), user } as unknown as A;
    });
}

/**
 * The first gate that proves an actor. A gate that finds its credential
 * invalid does not stop the others (a bearer token may be a JWT or an API
 * key); when none proves one, its 401 is the answer.
 */
export function anyOf<G extends Gate<Actor>[]>(...gates: G): Gate<ActorOf<G[number]>> {
    const challenge = [...new Set(gates.map((g) => g.challenge).filter(Boolean))].join(', ') || undefined;
    return gate(async (c) => {
        let refused: HttpError | undefined;
        for (const each of gates) {
            try {
                const actor = await each(c);
                if (actor) return actor as ActorOf<G[number]>;
            } catch (error) {
                if (!(error instanceof HttpError) || error.status !== 401) throw error;
                refused ??= error;
            }
        }
        if (refused) throw refused;
        return null;
    }, challenge);
}

/** Every gate must prove an actor (a client certificate and a token); the first one's is the actor. */
export function allOf<G extends Gate<Actor>[]>(...gates: G): Gate<ActorOf<G[0]>> {
    return gate(
        async (c) => {
            let first: Actor | undefined;
            for (const each of gates) {
                const actor = await each(c);
                if (!actor) return null;
                first ??= actor;
            }
            return (first ?? null) as ActorOf<G[0]> | null;
        },
        gates.find((g) => g.challenge)?.challenge,
    );
}

/**
 * Middleware that lets the request through only with an actor from `gate`,
 * in `c.var.actor` (typed as the gate's actor on this route); without a
 * credential, 401 with the gate's `WWW-Authenticate` challenge.
 */
export function requireActor<A extends Actor>(gate: Gate<A>): MiddlewareHandler<{ Variables: { actor: A } }> {
    return async (c, next) => {
        const actor = await gate(c);
        if (!actor) {
            throw new AuthError(
                'Unauthorized',
                gate.challenge ? { headers: { 'WWW-Authenticate': gate.challenge } } : {},
            );
        }
        c.set('actor', actor);
        await next();
    };
}

/**
 * Middleware that sets `c.var.actor` when the request proves one, and lets a
 * request without credentials through (a public route that shows more to a
 * user). Invalid credentials are still a 401.
 */
export function identify<A extends Actor>(gate: Gate<A>): MiddlewareHandler<{ Variables: { actor?: A } }> {
    return async (c, next) => {
        const actor = await gate(c);
        if (actor) c.set('actor', actor);
        await next();
    };
}

/**
 * Whether `granted` covers every scope `required`: a scope itself, `*`, or a
 * prefix ending in `:*` (`users:*` covers `users:read`).
 */
export function hasScopes(granted: readonly string[] | undefined, required: readonly string[]): boolean {
    return required.every((scope) =>
        (granted ?? []).some((g) => g === '*' || g === scope || (g.endsWith(':*') && scope.startsWith(g.slice(0, -1)))),
    );
}

/** Middleware after `requireActor`: 403 unless the actor has every scope (401 without an actor). */
export function requireScopes(...scopes: string[]): MiddlewareHandler {
    return async (c, next) => {
        const actor = c.get('actor') as Actor | undefined;
        if (!actor) throw new AuthError();
        if (!hasScopes(actor.scopes, scopes)) throw new ForbiddenError('Insufficient scopes');
        await next();
    };
}
