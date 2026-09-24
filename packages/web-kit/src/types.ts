import type { TrustProxy } from "./client-ip";
import type { Kernel } from "./kernel";

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
    environment?: "development" | "production" | "test";
    securityHeaders?: SecurityHeadersConfig; // Always applied, non-pluggable
    /**
     * Number of reverse proxies in front of the app (`true` = 1). Only then are
     * `X-Forwarded-For` / `X-Real-IP` used to identify clients (rate limiting);
     * by default the socket address is used. See `getClientIp`.
     */
    trustProxy?: TrustProxy;
}

export interface SecurityHeadersConfig {
    contentSecurityPolicy?:
    | string
    | {
        directives?: Record<string, string | string[]>;
    };
    xFrameOptions?: "DENY" | "SAMEORIGIN" | string;
    xContentTypeOptions?: boolean;
    strictTransportSecurity?: {
        maxAge?: number;
        includeSubDomains?: boolean;
        preload?: boolean;
    };
    xXssProtection?: boolean;
    referrerPolicy?:
    | "no-referrer"
    | "no-referrer-when-downgrade"
    | "origin"
    | "origin-when-cross-origin"
    | "same-origin"
    | "strict-origin"
    | "strict-origin-when-cross-origin"
    | "unsafe-url";
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
    metadata?: Record<string, any>;
}

export interface ApiKeyConfig {
    staticKeys?: Array<Partial<ApiKeyMetadata> & { key: string }>;
    headerName?: string;
    queryParamName?: string;
    extractStrategies?: ("header" | "bearer" | "query" | "custom")[];
    /** Not used yet: only `staticKeys` are validated. */
    vaultService?: any;
    customExtractor?: (c: any) => string | null;
    /**
     * @deprecated Ignored. Keys are looked up in memory on every request; the
     * cache kept a revoked key working and stored it in plaintext.
     */
    enableCache?: boolean;
    /** @deprecated Ignored, see `enableCache`. */
    cacheTtl?: number;
    requireScopes?: boolean;
    skipPaths?: string[];
    onError?: (error: string, c: any) => Response | Promise<Response>;
    onValidated?: (key: ApiKeyMetadata, c: any) => void | Promise<void>;
}

export interface CsrfConfig {
    secret: string;
    cookieName?: string;
    headerName?: string;
    ignoreMethods?: string[];
    cookieOptions?: {
        httpOnly?: boolean;
        secure?: boolean;
        sameSite?: "Strict" | "Lax" | "None";
        maxAge?: number;
    };
}

// Feature Interface
export interface Feature {
    name: string;
    dependencies?: string[]; // Required features
    peerDependencies?: string[]; // Required npm packages
    initialize(kernel: Kernel): Promise<void>;
    routes?: (app: any) => void;
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
    windowMs?: number;
    max?: number;
    keyGenerator?: (c: any) => string;
    skip?: (c: any) => boolean;
    handler?: (c: any) => Response;
    standardHeaders?: boolean;
    store?: "memory" | "cache";
}

export interface HealthCheckConfig {
    path?: string;
    readinessPath?: string;
    livenessPath?: string;
    includeDetails?: boolean;
    /** Per-check timeout for /health probes, in ms. Default 2000. */
    checkTimeoutMs?: number;
    checks?: {
        [key: string]: (context?: any) => Promise<{
            status: "ok" | "error";
            message?: string;
            details?: any;
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
        [key: number]: (error: Error, c: any) => Response;
    };
    logger?: (error: Error, c: any) => void;
}

export interface LoggerConfig {
    level?: "debug" | "info" | "error" | "trace" | "warning" | "fatal" | null | undefined;
    format?: "json" | "pretty";
    sinks?: Array<
        {
            type: "console" | "file";
            path?: string;
            level?: "debug" | "info" | "warn" | "error";
        } | Sink
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
     * Per-client-IP limit on the auth routes (default 20 requests / 15 min).
     * Raise it when a backend calls these routes on behalf of many users from
     * one IP (e.g. through the SDKs), or pass `false` to disable it.
     */
    rateLimit?: false | { max?: number; windowMs?: number };
    disableCSRFCheck?: boolean; // Disable CSRF protection (for testing)
    authMode?: "oidc" | "email"; // Authentication mode
    /**
     * Email/password sign-in. Defaults to `authMode === "email"`, so an OIDC
     * deployment does not also expose an open email/password login.
     */
    enableEmailPassword?: boolean;
    enableSelfRegistration?: boolean; // Allow `/sign-up/email` (default true); false = accounts are provisioned elsewhere

    // deno-lint-ignore no-explicit-any
    socialProviders?: Record<string, any>; // Allow other providers

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
    store: "db" | "cache" | "memory";
    secret: string;
    ttl?: number;
    cookieName?: string;
    cookieOptions?: {
        secure?: boolean;
        sameSite?: "Strict" | "Lax" | "None";
        domain?: string;
        path?: string;
    };
}

export interface DbConfig {
    adapter: "postgres" | "mysql" | "sqlite";
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
    adapter: "redis" | "memory";
    connection?: {
        host?: string;
        port?: number;
        password?: string;
        db?: number;
    };
    secret?: string;
    // ... (CacheConfig end)
    ttl?: number;
}

export interface PermissionsConfig {
    loadPermissions?: (userId: string) => Promise<string[]>;
    loadRoles?: (userId: string) => Promise<string[]>;
    anonymousPermissions?: string[];
    enableRBAC?: boolean;
    cachePermissions?: boolean;
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
    securitySchemes?: Record<string, any>;
}

export type UploadAction = "upload" | "list" | "download" | "delete";

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
    authorize?: (c: any, action: UploadAction) => boolean | Promise<boolean>;
}
