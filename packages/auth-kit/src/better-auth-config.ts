import { betterAuth, type Auth as BetterAuthInstance, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter, type DB as DrizzleAdapterDb } from 'better-auth/adapters/drizzle';
import { genericOAuth, type GenericOAuthUserInfo } from 'better-auth/plugins/generic-oauth';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { MySqlDatabase, MySqlQueryResultHKT, PreparedQueryHKTBase } from 'drizzle-orm/mysql-core';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { pgSchema, mysqlSchema, sqliteSchema } from './schema';

/**
 * The Drizzle database handle auth-kit accepts. A union of the supported dialect
 * databases (mirrors web-kit's `WebKitDrizzleDb`) so the public input is a real
 * Drizzle instance rather than `any` leaking into callers. The dialect-core base
 * classes are part of `drizzle-orm` itself, so no driver dependency is required.
 */
export type AuthKitDrizzleDb =
    | PgDatabase<PgQueryResultHKT, Record<string, unknown>>
    | MySqlDatabase<MySqlQueryResultHKT, PreparedQueryHKTBase, Record<string, unknown>>
    | BaseSQLiteDatabase<'sync' | 'async', unknown, Record<string, unknown>>;

/** Minimum length, in characters, for the session-signing secret. */
const MIN_SECRET_LENGTH = 32;

export interface BetterAuthConfigOptions {
    db: AuthKitDrizzleDb;
    adapterType: 'postgres' | 'mysql' | 'sqlite';
    secret: string;
    baseURL?: string;
    basePath?: string;
    trustedOrigins?: string[];
    enableEmailPassword?: boolean;
    /** Reject `/sign-up/email` (accounts are provisioned another way). Default false. */
    disableSignUp?: boolean;
    disableCSRFCheck?: boolean;
    /**
     * Cookie-cache lifetime in seconds. This is the session-revocation lag: a
     * revoked session keeps passing cached cookie checks until the cache entry
     * expires. Lower it to tighten the revocation window (at the cost of more
     * frequent DB lookups). Defaults to 300 (5 minutes).
     */
    cookieCacheMaxAge?: number;
    /**
     * `false` turns off better-auth's own rate limiter (on by default in
     * production), e.g. when the app limits the auth routes itself.
     */
    rateLimit?: false;
    /**
     * Request headers better-auth reads the client IP from, for its rate
     * limiter and the sessions' `ipAddress` (default `x-forwarded-for`, first
     * entry). Without a usable one, every client shares one rate-limit bucket.
     */
    ipAddressHeaders?: string[];
    /** better-auth's socialProviders option, as is. */
    socialProviders?: BetterAuthOptions['socialProviders'];
    oidcConfig?: {
        clientId: string;
        clientSecret: string;
        issuer: string;
        providerId?: string;
        authorizationEndpoint?: string;
        tokenEndpoint?: string;
        userinfoEndpoint?: string;
        jwksEndpoint?: string;
        discoveryEndpoint?: string;
        scopes?: string[];
        pkce?: boolean;
        mapping?: {
            id?: string;
            email?: string;
            emailVerified?: string;
            name?: string;
            image?: string;
            extraFields?: Record<string, string>;
        };
    };
}

/**
 * The local user fields for an OIDC login (standard claims, with the common
 * non-standard fallbacks). No `id`: better-auth takes the account's identity
 * from the verified `sub` (accountSubject) and ignores one returned here.
 */
export function mapOidcProfile(profile: GenericOAuthUserInfo) {
    const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);
    return {
        email: profile.email,
        name: profile.name || str(profile.preferred_username),
        image: str(profile.picture) ?? profile.image,
        emailVerified:
            profile.emailVerified === true || profile.email_verified === true || profile.email_verified === 'true',
    };
}

export function createBetterAuth(options: BetterAuthConfigOptions): BetterAuthInstance {
    const {
        db,
        adapterType,
        secret,
        baseURL = 'http://localhost:3000',
        basePath = '/api/auth',
        trustedOrigins = [],
        enableEmailPassword = true,
        disableSignUp = false,
        disableCSRFCheck = false,
        cookieCacheMaxAge = 5 * 60,
        socialProviders,
        oidcConfig,
        rateLimit,
        ipAddressHeaders,
    } = options;

    // A weak or empty secret signs forgeable sessions, so reject it before
    // betterAuth() ever sees it rather than silently building an insecure auth.
    if (!secret || secret.length < MIN_SECRET_LENGTH) {
        throw new Error(
            `auth secret must be at least ${MIN_SECRET_LENGTH} characters; received ${secret ? secret.length : 0}`,
        );
    }

    const baseOrigin = new URL(baseURL).origin;
    const allTrustedOrigins = trustedOrigins.includes(baseOrigin) ? trustedOrigins : [baseOrigin, ...trustedOrigins];

    let schema;
    let provider: 'pg' | 'mysql' | 'sqlite';

    switch (adapterType) {
        case 'postgres':
            schema = pgSchema;
            provider = 'pg';
            break;
        case 'mysql':
            schema = mysqlSchema;
            provider = 'mysql';
            break;
        case 'sqlite':
            schema = sqliteSchema;
            provider = 'sqlite';
            break;
        default:
            throw new Error(`Unsupported adapter type: ${adapterType}`);
    }

    const database = drizzleAdapter(db as unknown as DrizzleAdapterDb, {
        provider,
        schema,
    });

    const plugins = [];
    if (oidcConfig) {
        const authorizationUrl =
            oidcConfig.authorizationEndpoint || `${oidcConfig.issuer}/protocol/openid-connect/auth`;
        const tokenUrl = oidcConfig.tokenEndpoint || `${oidcConfig.issuer}/protocol/openid-connect/token`;
        const userInfoUrl = oidcConfig.userinfoEndpoint || `${oidcConfig.issuer}/protocol/openid-connect/userinfo`;

        plugins.push(
            genericOAuth({
                config: [
                    {
                        providerId: oidcConfig.providerId || 'oidc',
                        clientId: oidcConfig.clientId,
                        clientSecret: oidcConfig.clientSecret,
                        authorizationUrl,
                        tokenUrl,
                        userInfoUrl,
                        discoveryUrl:
                            oidcConfig.discoveryEndpoint || `${oidcConfig.issuer}/.well-known/openid-configuration`,
                        scopes: oidcConfig.scopes || ['openid', 'email', 'profile'],
                        // Secure default: PKCE on. Disabling exposes auth-code
                        // interception/injection and requires an explicit false.
                        pkce: oidcConfig.pkce !== undefined ? oidcConfig.pkce : true,
                        mapProfileToUser: mapOidcProfile,
                    },
                ],
            }),
        );
    }

    return betterAuth({
        database,
        secret,
        baseURL,
        basePath,
        trustedOrigins: allTrustedOrigins,
        emailAndPassword: enableEmailPassword
            ? {
                  enabled: true,
                  autoSignIn: true,
                  disableSignUp,
              }
            : undefined,
        socialProviders: Object.keys(socialProviders || {}).length > 0 ? socialProviders : undefined,
        plugins,
        session: {
            expiresIn: 60 * 60 * 24 * 7,
            updateAge: 60 * 60 * 24,
            cookieCache: {
                enabled: true,
                maxAge: cookieCacheMaxAge,
            },
        },
        ...(rateLimit === false ? { rateLimit: { enabled: false } } : {}),
        advanced: {
            disableCSRFCheck,
            // Pinned: left unset, better-auth skips its Origin check (CSRF on
            // cookie requests) and its callbackURL/redirectTo validation (open
            // redirects) whenever it thinks it runs under test: NODE_ENV=test,
            // or any TEST variable other than "false" (TEST=0 included).
            disableOriginCheck: false,
            generateId: () => crypto.randomUUID().replace(/-/g, ''),
            ...(ipAddressHeaders ? { ipAddress: { ipAddressHeaders } } : {}),
        },
    }) as unknown as BetterAuthInstance;
}

export type Auth = ReturnType<typeof createBetterAuth>;
