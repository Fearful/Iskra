import type { Feature, ApiKeyConfig, ApiKeyMetadata, ApiKeyValidationResult } from "../types";
import type { Kernel } from "../kernel";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { consoleLogger, type KernelLogger } from "../logging";

// Resolved config: scalar/array fields are always populated by the constructor
// defaults, while the genuinely optional callbacks stay optional. This replaces
// the previous `as unknown as Required<ApiKeyConfig>` cast, which masked shape
// drift by pretending the callbacks were always present.
type ResolvedApiKeyConfig =
    Required<Omit<ApiKeyConfig, "vaultService" | "customExtractor" | "onError" | "onValidated">>
    & Pick<ApiKeyConfig, "vaultService" | "customExtractor" | "onError" | "onValidated">;

// --- ApiKeyStore ---

/**
 * Validates keys against the configured `staticKeys`, on every request.
 *
 * Validated keys used to be cached (with `enableCache`, through the cache
 * feature): the cached entry held the plaintext key, and on a hit its scopes
 * and expiry were used instead of the current config, so a key revoked or
 * narrowed in the config kept working for `cacheTtl` on every instance
 * sharing the cache. A lookup in the in-memory map needs no cache.
 */
export class ApiKeyStore {
    private staticKeysMap: Map<string, ApiKeyMetadata> = new Map();

    constructor(private config: ResolvedApiKeyConfig, _kernel?: Kernel) {
        this.initializeStaticKeys();
    }

    private initializeStaticKeys(): void {
        if (!this.config.staticKeys || this.config.staticKeys.length === 0) {
            return;
        }

        for (const staticKey of this.config.staticKeys) {
            const metadata: ApiKeyMetadata = {
                id: this.generateId(staticKey.key),
                key: staticKey.key,
                name: staticKey.name,
                scopes: staticKey.scopes,
                rateLimit: staticKey.rateLimit,
                expiresAt: staticKey.expiresAt,
                createdAt: new Date(),
                metadata: staticKey.metadata,
                lastUsedAt: undefined // Explicitly undefined initially
            };

            this.staticKeysMap.set(staticKey.key, metadata);
        }
    }

    private generateId(_key: string): string {
        // Derive the id independently of the secret key material so it can never
        // leak a usable prefix of the key. Lookup is keyed by the plaintext key
        // (staticKeysMap), never by id, so a random id is sufficient.
        return crypto.randomUUID();
    }

    private compareKeys(a: string, b: string): boolean {
        if (a.length !== b.length) return false;
        let result = 0;
        for (let i = 0; i < a.length; i++) {
            result |= a.charCodeAt(i) ^ b.charCodeAt(i);
        }
        return result === 0;
    }

    private isExpired(expiresAt?: Date): boolean {
        if (!expiresAt) return false;
        return new Date() > expiresAt;
    }

    async validate(key: string): Promise<ApiKeyValidationResult> {
        if (!key) return { isValid: false, error: "API key is required" };

        for (const [staticKey, metadata] of this.staticKeysMap) {
            if (this.compareKeys(key, staticKey)) {
                if (this.isExpired(metadata.expiresAt)) {
                    return { isValid: false, error: "API key has expired" };
                }
                // Build a derived object instead of mutating the metadata held in
                // staticKeysMap (immutability — the stored object must stay intact).
                return { isValid: true, key: { ...metadata, lastUsedAt: new Date() } };
            }
        }

        return { isValid: false, error: "Invalid API key" };
    }

    hasScopes(key: ApiKeyMetadata, requiredScopes: string[]): boolean {
        if (!requiredScopes || requiredScopes.length === 0) return true;
        if (!key.scopes || key.scopes.length === 0) return false;

        for (const requiredScope of requiredScopes) {
            const hasScope = key.scopes.some((scope) => {
                if (scope.endsWith("*")) {
                    const prefix = scope.slice(0, -1);
                    return requiredScope.startsWith(prefix);
                }
                return scope === requiredScope;
            });

            if (!hasScope) return false;
        }
        return true;
    }
}

// --- ApiKeyFeature ---

declare module "hono" {
    interface ContextVariableMap {
        apiKey?: ApiKeyMetadata;
        apiKeyScopes?: string[];
        hasScope?: (scope: string) => boolean;
        hasAnyScope?: (...scopes: string[]) => boolean;
        hasAllScopes?: (...scopes: string[]) => boolean;
        /** Why a Bearer token was not accepted as an API key (see requireApiKey). */
        apiKeyError?: string;
    }
}

export class ApiKeyFeature implements Feature {
    name = "apiKey";
    private log: KernelLogger = consoleLogger;
    private store?: ApiKeyStore;
    private config: ResolvedApiKeyConfig;

    constructor(config: ApiKeyConfig = {}) {
        // Explicit, fully-typed defaults object — every resolved field is assigned
        // a concrete value so shape drift surfaces at compile time instead of
        // being masked by an `as unknown as` cast.
        const defaults: ResolvedApiKeyConfig = {
            staticKeys: config.staticKeys || [],
            headerName: config.headerName || "X-API-Key",
            queryParamName: config.queryParamName || "api_key",
            extractStrategies: config.extractStrategies || ["header", "bearer"],
            vaultService: config.vaultService,
            customExtractor: config.customExtractor,
            enableCache: config.enableCache ?? true,
            cacheTtl: config.cacheTtl ?? 300000,
            requireScopes: config.requireScopes ?? false,
            skipPaths: config.skipPaths || [],
            onError: config.onError,
            onValidated: config.onValidated,
        };
        this.config = defaults;
    }

    async initialize(kernel: Kernel): Promise<void> {
        this.log = kernel.getLogger();
        this.store = new ApiKeyStore(this.config, kernel);
        const app = kernel.getApp();

        app.use("*", async (c: Context, next: Next) => {
            if (this.shouldSkipPath(c.req.path)) {
                await next();
                return;
            }

            const extracted = this.extractApiKey(c);
            if (!extracted) {
                c.set("apiKey", undefined);
                c.set("apiKeyScopes", undefined);
                await next();
                return;
            }

            const result = await this.store!.validate(extracted.key);
            if (!result.isValid) {
                const error = result.error || "Invalid API key";
                if (extracted.strategy === "bearer") {
                    // A Bearer token may belong to another auth scheme (a JWT, a
                    // session token). Rejecting it here would 401 every such
                    // request app-wide, public routes included; routes that need
                    // an API key enforce it with requireApiKey()/requireScope().
                    c.set("apiKey", undefined);
                    c.set("apiKeyScopes", undefined);
                    c.set("apiKeyError", error);
                    await next();
                    return;
                }
                if (this.config.onError) return this.config.onError(error, c);
                throw new HTTPException(401, { message: error });
            }

            // When requireScopes is enabled, a validated key that carries no scope
            // is treated as insufficiently privileged and rejected.
            if (this.config.requireScopes && !(result.key?.scopes && result.key.scopes.length > 0)) {
                if (this.config.onError) return this.config.onError("API key has no scopes", c);
                throw new HTTPException(403, { message: "API key has no scopes" });
            }

            c.set("apiKey", result.key);
            c.set("apiKeyScopes", result.key?.scopes || []);

            c.set("hasScope", (scope: string) => this.store!.hasScopes(result.key!, [scope]));
            c.set("hasAnyScope", (...scopes: string[]) => scopes.some(s => this.store!.hasScopes(result.key!, [s])));
            c.set("hasAllScopes", (...scopes: string[]) => this.store!.hasScopes(result.key!, scopes));

            if (this.config.onValidated) await this.config.onValidated(result.key!, c);
            await next();
        });

        this.log.debug(`API Key feature initialized (${this.config.staticKeys?.length ?? 0} static keys)`);
    }

    private shouldSkipPath(path: string): boolean {
        if (!this.config.skipPaths?.length) return false;
        return this.config.skipPaths.some(skip => {
            if (skip.endsWith("*")) return path.startsWith(skip.slice(0, -1));
            return path === skip;
        });
    }

    private extractApiKey(c: Context): { key: string; strategy: string } | null {
        for (const strategy of (this.config.extractStrategies || [])) {
            let key: string | null = null;
            switch (strategy) {
                case "header":
                    key = c.req.header(this.config.headerName) || null;
                    break;
                case "bearer": {
                    const auth = c.req.header("Authorization");
                    if (auth?.startsWith("Bearer ")) key = auth.substring(7);
                    break;
                }
                case "query":
                    key = c.req.query(this.config.queryParamName) || null;
                    break;
                case "custom":
                    key = this.config.customExtractor?.(c) || null;
                    break;
            }
            if (key) return { key, strategy };
        }
        return null;
    }
}

export function requireApiKey() {
    return async (c: Context, next: Next) => {
        if (!c.get("apiKey")) throw new HTTPException(401, { message: c.get("apiKeyError") || "API key is required" });
        await next();
    };
}

export function requireScope(...scopes: string[]) {
    return async (c: Context, next: Next) => {
        const hasAll = c.get("hasAllScopes");
        if (!c.get("apiKey")) throw new HTTPException(401, { message: c.get("apiKeyError") || "API key is required" });
        if (!hasAll || !hasAll(...scopes)) throw new HTTPException(403, { message: "Insufficient scopes" });
        await next();
    };
}
