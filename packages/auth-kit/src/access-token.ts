import { decryptOAuthToken, setTokenUtil } from 'better-auth/oauth2';
import type { Auth } from './better-auth-config';

/** Why an OAuth access token could not be handed out. */
export type OAuthTokenErrorCode =
    /** `headers` were given but carry no valid session. */
    | 'NOT_SIGNED_IN'
    /** The user has no account with that provider. */
    | 'ACCOUNT_NOT_LINKED'
    /** The token expired and cannot be renewed (no refresh token, or a provider that does not renew). */
    | 'TOKEN_EXPIRED'
    /** The stored token cannot be decrypted: the auth secret changed, or it was stored before encryption. */
    | 'TOKEN_UNREADABLE'
    /** The provider answered `invalid_grant`: the refresh token is revoked, already used or expired. */
    | 'REFRESH_FAILED'
    /**
     * The renewal did not go through for a reason signing in again would not
     * fix: no answer within `timeoutMs`, a network error, a 5xx, a 429, or
     * another OAuth error (`invalid_client` is the app's credentials). Retry
     * later; the session and the stored pair are kept.
     */
    | 'PROVIDER_UNAVAILABLE';

/**
 * No access token could be handed out. For every code but
 * `PROVIDER_UNAVAILABLE` the user has to sign in again (`requiresSignIn`);
 * web-kit's `getAccessToken` answers those with 401 and the other with 502.
 */
export class OAuthTokenError extends Error {
    override readonly name = 'OAuthTokenError';
    constructor(
        readonly code: OAuthTokenErrorCode,
        readonly providerId: string,
        options?: { cause?: unknown },
    ) {
        super(`${providerId} access token unavailable: ${code}`, options);
    }

    /** Whether signing in again (with the provider) is what fixes it. */
    get requiresSignIn(): boolean {
        return this.code !== 'PROVIDER_UNAVAILABLE';
    }
}

export interface ProviderAccessTokenOptions {
    /** The provider's id: `'gitlab'`, `'github'`, the `providerId` of `oidcConfig`… */
    providerId: string;
    /**
     * The request's headers. The session they carry is read from the database
     * (not the cookie cache), so a revoked session cannot get tokens, and its
     * user wins over `userId`.
     */
    headers?: Headers;
    /** The user to act for when there is no request (a background job). */
    userId?: string;
    /** Which of the user's accounts with that provider, when they linked more than one. */
    accountId?: string;
    /**
     * Renew the token when it has less than this left, in ms (default
     * 60 000): a token about to expire can expire while the call that uses it
     * is in flight.
     */
    minValidityMs?: number;
    /**
     * How long to wait for the provider's token endpoint, in ms (default
     * 10 000), before answering `PROVIDER_UNAVAILABLE`. An answer that comes
     * later is still stored, and the account's next renewal waits for it: the
     * provider may already have retired the old refresh token.
     */
    timeoutMs?: number;
}

export interface ProviderAccessToken {
    accessToken: string;
    /** When the token expires; `undefined` when the provider did not say. */
    accessTokenExpiresAt?: Date;
    scopes: string[];
    /** The better-auth account the token belongs to. */
    accountId: string;
}

const DEFAULT_MIN_VALIDITY_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;

interface AccountRow {
    id: string;
    providerId: string;
    accessToken?: string | null;
    refreshToken?: string | null;
    accessTokenExpiresAt?: Date | string | null;
    refreshTokenExpiresAt?: Date | string | null;
    scope?: string | null;
}

interface RefreshingProvider {
    id: string;
    refreshAccessToken?: (refreshToken: string) => Promise<{
        accessToken?: string;
        refreshToken?: string;
        accessTokenExpiresAt?: Date;
        refreshTokenExpiresAt?: Date;
        idToken?: string;
    }>;
}

type AuthContext = Awaited<Auth['$context']>;

/**
 * Per auth instance, the renewal in progress for each account. Providers
 * that rotate refresh tokens (GitLab does) accept each one once, so a second
 * concurrent renewal with the same token would fail and sign the user out.
 */
const renewals = new WeakMap<object, Map<string, Promise<unknown>>>();

/**
 * Runs `task` after the previous task for `key` settles, one at a time. The
 * next one also waits for what the task passes to `hold()` (a renewal its
 * caller stopped waiting for).
 */
function serialized<T>(
    owner: object,
    key: string,
    task: (hold: (pending: Promise<unknown>) => void) => Promise<T>,
): Promise<T> {
    let queue = renewals.get(owner);
    if (!queue) renewals.set(owner, (queue = new Map()));
    const previous = queue.get(key) ?? Promise.resolve();
    const held: Promise<unknown>[] = [];
    const hold = (pending: Promise<unknown>) => void held.push(pending);
    const run = previous.then(
        () => task(hold),
        () => task(hold),
    );
    const tail = run.then(
        () => Promise.allSettled(held),
        () => Promise.allSettled(held),
    );
    queue.set(key, tail);
    void tail.then(() => {
        if (queue.get(key) === tail) queue.delete(key);
    });
    return run;
}

function toDate(value: unknown): Date | undefined {
    if (value === undefined || value === null) return undefined;
    const date = value instanceof Date ? value : new Date(value as string);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseScopes(scope: string | null | undefined): string[] {
    return scope ? scope.split(/[\s,]+/).filter(Boolean) : [];
}

/**
 * A valid access token for the user's account with `providerId`, renewed
 * with the refresh token when it expires within `minValidityMs`. Tokens are
 * stored encrypted (see `createBetterAuth`), and a renewed pair is stored
 * the same way.
 *
 * Renewals of one account run one at a time in this process; with several
 * instances of the app, two of them can still renew the same account at once.
 *
 * Throws {@link OAuthTokenError} when no token can be handed out; any other
 * error (the database) is rethrown as is.
 */
export async function getProviderAccessToken(
    auth: Auth,
    options: ProviderAccessTokenOptions,
): Promise<ProviderAccessToken> {
    const { providerId } = options;
    const minValidityMs = options.minValidityMs ?? DEFAULT_MIN_VALIDITY_MS;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const userId = await resolveUserId(auth, options);
    const context = await auth.$context;

    const findAccount = async (): Promise<AccountRow> => {
        const accounts = (await context.internalAdapter.findAccounts(userId)) as AccountRow[];
        const matching = accounts.filter(
            (a) => a.providerId === providerId && (!options.accountId || a.id === options.accountId),
        );
        if (matching.length === 0) throw new OAuthTokenError('ACCOUNT_NOT_LINKED', providerId);
        if (matching.length > 1) {
            throw new Error(
                `getProviderAccessToken: the user has ${matching.length} ${providerId} accounts; pass accountId to pick one`,
            );
        }
        return matching[0]!;
    };
    const isFresh = (row: AccountRow) => {
        const expiresAt = toDate(row.accessTokenExpiresAt);
        return expiresAt === undefined || expiresAt.getTime() - Date.now() >= minValidityMs;
    };

    const account = await findAccount();
    if (isFresh(account)) return decrypted(context, account, providerId);

    return serialized(auth, account.id, async (hold) => {
        // A renewal that ran while this one waited already stored a new pair.
        const current = await findAccount();
        if (isFresh(current)) return decrypted(context, current, providerId);
        const renewed = await renew(context, current, providerId, timeoutMs, hold);
        if (renewed) return renewed;
        // Nothing to renew with: the token is still good for a little while, or it is gone.
        if (toDate(current.accessTokenExpiresAt)!.getTime() > Date.now()) {
            return decrypted(context, current, providerId);
        }
        throw new OAuthTokenError('TOKEN_EXPIRED', providerId);
    });
}

async function resolveUserId(auth: Auth, options: ProviderAccessTokenOptions): Promise<string> {
    if (options.headers) {
        const session = await auth.api.getSession({
            headers: options.headers,
            query: { disableCookieCache: true },
        });
        if (!session?.user) throw new OAuthTokenError('NOT_SIGNED_IN', options.providerId);
        return session.user.id;
    }
    if (!options.userId) throw new Error('getProviderAccessToken: pass the request headers or a userId');
    return options.userId;
}

async function decrypt(context: AuthContext, token: string, providerId: string): Promise<string> {
    try {
        return await decryptOAuthToken(token, context);
    } catch (err) {
        throw new OAuthTokenError('TOKEN_UNREADABLE', providerId, { cause: err });
    }
}

async function decrypted(context: AuthContext, account: AccountRow, providerId: string): Promise<ProviderAccessToken> {
    if (!account.accessToken) throw new OAuthTokenError('TOKEN_EXPIRED', providerId);
    return {
        accessToken: await decrypt(context, account.accessToken, providerId),
        accessTokenExpiresAt: toDate(account.accessTokenExpiresAt),
        scopes: parseScopes(account.scope),
        accountId: account.id,
    };
}

async function findProvider(context: AuthContext, providerId: string): Promise<RefreshingProvider | undefined> {
    const providers = (context.socialProviders ?? []) as unknown[];
    for (const entry of providers) {
        const provider = (typeof entry === 'function' ? await entry() : entry) as RefreshingProvider;
        if (provider?.id === providerId) return provider;
    }
    return undefined;
}

/** Rejects with PROVIDER_UNAVAILABLE when `promise` is not settled within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, providerId: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
            () =>
                reject(
                    new OAuthTokenError('PROVIDER_UNAVAILABLE', providerId, {
                        cause: new Error(`${providerId} token endpoint did not answer within ${ms}ms`),
                    }),
                ),
            ms,
        );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Why a renewal failed. Only `invalid_grant` (RFC 6749) says the refresh
 * token itself is no good; a 429, `invalid_client` (the app's credentials),
 * a 5xx or a network error would sign every user out without anything they
 * could fix by signing in.
 */
function renewalError(err: unknown, providerId: string): OAuthTokenError {
    const oauthError = (err as { error?: unknown } | null)?.error;
    return new OAuthTokenError(oauthError === 'invalid_grant' ? 'REFRESH_FAILED' : 'PROVIDER_UNAVAILABLE', providerId, {
        cause: err,
    });
}

/**
 * Renews the account's pair with the provider and stores it encrypted, as
 * better-auth's own refresh does; `undefined` when there is nothing to renew
 * with. Past `timeoutMs` the caller gets PROVIDER_UNAVAILABLE, but the answer
 * is still stored when it comes, and `hold` keeps the account's next renewal
 * waiting for it: the provider may have retired the old refresh token.
 */
async function renew(
    context: AuthContext,
    account: AccountRow,
    providerId: string,
    timeoutMs: number,
    hold: (pending: Promise<unknown>) => void,
): Promise<ProviderAccessToken | undefined> {
    if (!account.refreshToken) return undefined;
    const provider = await findProvider(context, providerId);
    if (!provider?.refreshAccessToken) return undefined;

    const refreshToken = await decrypt(context, account.refreshToken, providerId);
    // Through a promise: a provider that throws right away is classified too.
    const exchange = Promise.resolve().then(() => provider.refreshAccessToken!(refreshToken));
    const stored = exchange.then((tokens) => (tokens.accessToken ? store(context, account, tokens) : undefined));
    hold(stored);

    let tokens: Awaited<typeof exchange>;
    try {
        tokens = await withTimeout(exchange, timeoutMs, providerId);
    } catch (err) {
        throw err instanceof OAuthTokenError ? err : renewalError(err, providerId);
    }
    if (!tokens.accessToken) throw new OAuthTokenError('PROVIDER_UNAVAILABLE', providerId);
    await stored;
    return {
        accessToken: tokens.accessToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        scopes: parseScopes(account.scope),
        accountId: account.id,
    };
}

type RenewedTokens = Awaited<ReturnType<NonNullable<RefreshingProvider['refreshAccessToken']>>>;

async function store(context: AuthContext, account: AccountRow, tokens: RenewedTokens): Promise<void> {
    await context.internalAdapter.updateAccount(account.id, {
        accessToken: await setTokenUtil(tokens.accessToken, context),
        // null, not undefined (which leaves the old, expired date): no expiry given is no expiry known.
        accessTokenExpiresAt: tokens.accessTokenExpiresAt ?? null,
        // Providers that do not rotate answer without one: the stored one stays good.
        refreshToken: tokens.refreshToken ? await setTokenUtil(tokens.refreshToken, context) : account.refreshToken,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ?? toDate(account.refreshTokenExpiresAt),
        ...(tokens.idToken ? { idToken: tokens.idToken } : {}),
    });
}
