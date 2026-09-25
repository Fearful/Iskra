import type { Context, Hono } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterAuthConfigOptions } from '@iskra-bun/auth-kit';
import type { ClientIpHeader, TrustProxy } from './client-ip';
import type { KernelLogger } from './logging';
import type { Kernel } from './kernel';

export type { Kernel };

// Simplified Logger Sink interface to avoid dependency on logtape for now
export interface Sink {
    (record: Record<string, unknown>): void;
}

export interface KernelConfig {
    port?: number;
    /** Interface to bind. Default "0.0.0.0" (all); use "127.0.0.1" for local only. */
    hostname?: string;
    /** Largest request body Bun.serve accepts, in bytes (413 above). Default 16 MiB. */
    maxRequestBodySize?: number;
    /** Seconds a connection may stay idle before Bun closes it (Bun default: 10). */
    idleTimeout?: number;
    /** How long shutdown() waits for in-flight requests before closing connections, in ms. Default 5000. */
    shutdownGraceMs?: number;
    environment?: 'development' | 'production' | 'test';
    securityHeaders?: SecurityHeadersConfig; // Always applied, non-pluggable
    /**
     * Number of reverse proxies in front of the app (`true` = 1). Only then is
     * `clientIpHeader` used to identify clients (rate limiting); by default the
     * socket address is used. See `getClientIp`.
     */
    trustProxy?: TrustProxy;
    /**
     * The header those proxies put the client address in: `'x-forwarded-for'`
     * (default) or `'x-real-ip'`. Only that one is read.
     */
    clientIpHeader?: ClientIpHeader;
    /**
     * Where the Kernel and its features log (startup, fallbacks, errors they
     * handle). Default: the console. `false`: nothing. WebPlugin passes the
     * App's logger unless one is given here.
     */
    logger?: KernelLogger | false;
}

export interface SecurityHeadersConfig {
    contentSecurityPolicy?:
        | string
        | {
              directives?: Record<string, string | string[]>;
          };
    /** `false` turns the default (`SAMEORIGIN`) off; `undefined` keeps it. */
    xFrameOptions?: 'DENY' | 'SAMEORIGIN' | string | false;
    xContentTypeOptions?: boolean;
    strictTransportSecurity?: {
        maxAge?: number;
        includeSubDomains?: boolean;
        preload?: boolean;
    };
    xXssProtection?: boolean;
    referrerPolicy?:
        | 'no-referrer'
        | 'no-referrer-when-downgrade'
        | 'origin'
        | 'origin-when-cross-origin'
        | 'same-origin'
        | 'strict-origin'
        | 'strict-origin-when-cross-origin'
        | 'unsafe-url'
        | false;
    permissionsPolicy?: Record<string, string[]>;
}

export interface ApiKeyValidationResult {
    isValid: boolean;
    key?: ApiKeyMetadata;
    error?: string;
}

export interface ApiKeyMetadata {
    id: string;
    key: string;
    name?: string;
    scopes?: string[];
    rateLimit?: {
        max: number;
        windowMs: number;
    };
    expiresAt?: Date;
    createdAt: Date;
    lastUsedAt?: Date;
    metadata?: Record<string, unknown>;
}

export interface ApiKeyConfig {
    staticKeys?: Array<Partial<ApiKeyMetadata> & { key: string }>;
    headerName?: string;
    queryParamName?: string;
    extractStrategies?: ('header' | 'bearer' | 'query' | 'custom')[];
    customExtractor?: (c: Context) => string | null;
    /**
     * @deprecated Ignored. Keys are looked up in memory on every request; the
     * cache kept a revoked key working and stored it in plaintext.
     */
    enableCache?: boolean;
    /** @deprecated Ignored, see `enableCache`. */
    cacheTtl?: number;
    requireScopes?: boolean;
    skipPaths?: string[];
    onError?: (error: string, c: Context) => Response | Promise<Response>;
    onValidated?: (key: ApiKeyMetadata, c: Context) => void | Promise<void>;
}

export interface CsrfConfig {
    /** Signs the tokens; at least 32 characters. */
    secret: string;
    /** Default `"__Host-csrf"` while the cookie is Secure (the default), `"_csrf"` otherwise. */
    cookieName?: string;
    headerName?: string;
    ignoreMethods?: string[];
    /**
     * Other origins whose pages may send state-changing requests (e.g. a
     * frontend on another subdomain), as `https://app.example.com`. Requests
     * whose `Origin` is neither the app's own nor one of these are rejected.
     */
    trustedOrigins?: string[];
    cookieOptions?: {
        httpOnly?: boolean;
        secure?: boolean;
        sameSite?: 'Strict' | 'Lax' | 'None';
        maxAge?: number;
    };
}

// Feature Interface
export interface Feature {
    name: string;
    dependencies?: string[]; // Required features
    optionalDependencies?: string[]; // Features initialized first when they are registered
    peerDependencies?: string[]; // Required npm packages
    initialize(kernel: Kernel): Promise<void>;
    routes?: (app: Hono) => void;
    shutdown?(): Promise<void>;
}

// Configs for Standard Features

export interface CorsConfig {
    origin?: string | string[] | ((origin: string) => boolean);
    credentials?: boolean;
    allowMethods?: string[];
    allowHeaders?: string[];
    exposeHeaders?: string[];
    maxAge?: number;
}

export interface RateLimitConfig {
    /**
     * Feature name, `'rate-limit'` by default. Feature names are unique, so a
     * second limiter (e.g. a stricter one for login) needs its own; its
     * counters are kept apart from the other limiter's.
     */
    name?: string;
    windowMs?: number;
    max?: number;
    keyGenerator?: (c: Context) => string;
    skip?: (c: Context) => boolean;
    handler?: (c: Context) => Response;
    standardHeaders?: boolean;
    store?: 'memory' | 'cache';
    /**
     * Most clients the memory store tracks at once (default 100 000). Past it
     * the oldest are dropped, and they start a new window.
     */
    maxKeys?: number;
}

export interface HealthCheckConfig {
    path?: string;
    readinessPath?: string;
    livenessPath?: string;
    includeDetails?: boolean;
    /** Per-check timeout for /health probes, in ms. Default 2000. */
    checkTimeoutMs?: number;
    checks?: {
        [key: string]: (c: Context) => Promise<{
            status: 'ok' | 'error';
            message?: string;
            details?: unknown;
        }>;
    };
    readinessChecks?: {
        [name: string]: () => Promise<boolean>;
    };
}

export interface RequestIdConfig {
    headerName?: string;
    generator?: () => string;
}

export interface ErrorHandlerConfig {
    includeStack?: boolean;
    customHandlers?: {
        [key: number]: (error: Error, c: Context) => Response;
    };
    logger?: (error: Error, c: Context) => void;
}

export interface LoggerConfig {
    level?: 'debug' | 'info' | 'error' | 'trace' | 'warning' | 'fatal' | null | undefined;
    format?: 'json' | 'pretty';
    sinks?: Array<
        | {
              type: 'console' | 'file';
              path?: string;
              level?: 'debug' | 'info' | 'warn' | 'error';
          }
        | Sink
    >;
    logRequests?: boolean;
    logResponses?: boolean;
}

export interface AuthConfig {
    secret: string;
    basePath?: string; // Default: "/api/sso"
    baseURL?: string; // For better-auth
    trustedOrigins?: string[]; // For better-auth CORS
    /**
     * Per-client-IP limit on the auth routes (default 20 requests / 15 min,
     * IPv6 clients by /64, at most `maxKeys` clients tracked: 100 000).
     * Raise it when a backend calls these routes on behalf of many users from
     * one IP (e.g. through the SDKs), or pass `false` to disable it.
     */
    rateLimit?: false | { max?: number; windowMs?: number; maxKeys?: number };
    disableCSRFCheck?: boolean; // Disable CSRF protection (for testing)
    /**
     * Lifetime of better-auth's signed session cookie cache, in seconds
     * (default 300). Sessions are checked against that cookie without a
     * database lookup, so a session revoked by sign-out or "revoke sessions"
     * keeps working this long; lower it to shorten that window.
     */
    cookieCacheMaxAge?: number;
    authMode?: 'oidc' | 'email'; // Authentication mode
    /**
     * Email/password sign-in. Defaults to `authMode === "email"`, so an OIDC
     * deployment does not also expose an open email/password login.
     */
    enableEmailPassword?: boolean;
    enableSelfRegistration?: boolean; // Allow `/sign-up/email` (default true); false = accounts are provisioned elsewhere

    /** better-auth's socialProviders option, as is. */
    socialProviders?: BetterAuthConfigOptions['socialProviders'];

    // OIDC Configuration for Keycloak and other OIDC providers
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

export interface SessionConfig {
    store: 'db' | 'cache' | 'memory';
    secret: string;
    ttl?: number;
    cookieName?: string;
    cookieOptions?: {
        secure?: boolean;
        sameSite?: 'Strict' | 'Lax' | 'None';
        domain?: string;
        path?: string;
    };
}

export interface DbConfig {
    adapter: 'postgres' | 'mysql' | 'sqlite';
    connection?: {
        host?: string;
        port?: number;
        database?: string;
        user?: string;
        password?: string;
        connectionString?: string;
    };
}

export interface CacheConfig {
    adapter: 'redis' | 'memory';
    connection?: {
        host?: string;
        port?: number;
        password?: string;
        db?: number;
    };
    secret?: string;
    // ... (CacheConfig end)
    ttl?: number;
    /**
     * Memory adapter only: most entries kept (default 100 000). Past it the
     * oldest writes are dropped; expired entries are swept every minute.
     */
    maxEntries?: number;
}

export interface PermissionsConfig {
    loadPermissions?: (userId: string) => Promise<string[]>;
    loadRoles?: (userId: string) => Promise<string[]>;
    anonymousPermissions?: string[];
    enableRBAC?: boolean;
    /** Keep each user's permissions and roles in the cache feature (default true). */
    cachePermissions?: boolean;
    /**
     * Seconds a user's cached permissions and roles are used (default 60): a
     * revoked role keeps working that long unless you call
     * `PermissionsFeature#invalidate(userId)`.
     */
    cacheTTL?: number;
}

export interface Role {
    name: string;
    permissions: string[];
    description?: string;
}

export interface OpenAPIConfig {
    title: string;
    version: string;
    description?: string;
    servers?: Array<{ url: string; description?: string }>;
    tags?: Array<{ name: string; description?: string }>;
    contact?: { name?: string; email?: string; url?: string };
    license?: { name: string; url?: string };
    externalDocs?: { description: string; url: string };
    security?: Array<Record<string, string[]>>;
    /** OpenAPI security scheme objects, by name (as in the spec's components). */
    securitySchemes?: NonNullable<
        NonNullable<ReturnType<OpenAPIHono['getOpenAPIDocument']>['components']>['securitySchemes']
    >;
}

export type UploadAction = 'upload' | 'list' | 'download' | 'delete';

export interface UploadConfig {
    projectName: string;
    /**
     * Largest file the upload route accepts, in bytes (default 10 MiB). With
     * `exposeRoutes` it must fit, plus 64 KiB of multipart overhead, in the
     * Kernel's `maxRequestBodySize` (16 MiB by default): initialize() fails otherwise.
     */
    maxFileSize?: number;
    allowedExtensions?: string[];
    exposeRoutes?: boolean;
    routePrefix?: string;
    /**
     * Required with `exposeRoutes`: whether the request may perform `action` on
     * the built-in upload routes (e.g. check `c.get("user")`). Pass
     * `() => true` to make them public on purpose.
     */
    authorize?: (c: Context, action: UploadAction) => boolean | Promise<boolean>;
}
