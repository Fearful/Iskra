import type { Feature, ApiKeyConfig, ApiKeyMetadata, ApiKeyValidationResult } from "../types";
import type { Kernel } from "../kernel";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";

// --- ApiKeyStore ---

export class ApiKeyStore {
    private staticKeysMap: Map<string, ApiKeyMetadata> = new Map();
    private cache?: any;

    constructor(private config: Required<ApiKeyConfig>, private kernel: Kernel) {
        this.initializeStaticKeys();
    }

    private getCache() {
        if (!this.cache && this.config.enableCache) {
            const cacheFeature = this.kernel.getFeature<any>('cache');
            if (cacheFeature) {
                this.cache = cacheFeature.client;
            }
        }
        return this.cache;
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
        console.log(`✅ Loaded ${this.staticKeysMap.size} static API keys`);
    }

    private generateId(key: string): string {
        return key.substring(0, 8);
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

        const cache = this.getCache();
        const cacheKey = `apikey:${key}`;

        if (cache) {
            try {
                const cached = await cache.get(cacheKey);
                if (cached) {
                    const metadata = typeof cached === 'string' ? JSON.parse(cached) : cached;
                    return { isValid: true, key: metadata };
                }
            } catch (err) {
                // Cache error, ignore
            }
        }

        // Check static keys
        for (const [staticKey, metadata] of this.staticKeysMap) {
            if (this.compareKeys(key, staticKey)) {
                if (this.isExpired(metadata.expiresAt)) {
                    return { isValid: false, error: "API key has expired" };
                }
                metadata.lastUsedAt = new Date();

                if (cache) {
                    const ttl = this.config.cacheTtl ? Math.floor(this.config.cacheTtl / 1000) : 300;
                    try {
                        await cache.set(cacheKey, JSON.stringify(metadata), ttl);
                    } catch {
                        // ignore cache write failures — validation already succeeded
                    }
                }

                return { isValid: true, key: metadata };
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
    }
}

export class ApiKeyFeature implements Feature {
    name = "apiKey";
    private store?: ApiKeyStore;
    private config: Required<ApiKeyConfig>;

    constructor(config: ApiKeyConfig = {}) {
        this.config = {
            staticKeys: config.staticKeys || [],
            headerName: config.headerName || "X-API-Key",
            queryParamName: config.queryParamName || "api_key",
            extractStrategies: config.extractStrategies || ["header", "bearer"],
            // Defaults for other optional properties
            vaultService: undefined,
            customExtractor: undefined,
            enableCache: config.enableCache ?? true,
            cacheTtl: config.cacheTtl ?? 300000,
            requireScopes: config.requireScopes ?? false,
            skipPaths: config.skipPaths || [],
            onError: config.onError,
            onValidated: config.onValidated
        } as unknown as Required<ApiKeyConfig>;
    }

    async initialize(kernel: Kernel): Promise<void> {
        this.store = new ApiKeyStore(this.config, kernel);
        const app = kernel.getApp();

        app.use("*", async (c: Context, next: Next) => {
            if (this.shouldSkipPath(c.req.path)) {
                await next();
                return;
            }

            const apiKey = this.extractApiKey(c);
            if (!apiKey) {
                c.set("apiKey", undefined);
                c.set("apiKeyScopes", undefined);
                await next();
                return;
            }

            const result = await this.store!.validate(apiKey);
            if (!result.isValid) {
                throw new HTTPException(401, { message: result.error || "Invalid API key" });
            }

            c.set("apiKey", result.key);
            c.set("apiKeyScopes", result.key?.scopes || []);

            c.set("hasScope", (scope: string) => this.store!.hasScopes(result.key!, [scope]));
            c.set("hasAnyScope", (...scopes: string[]) => scopes.some(s => this.store!.hasScopes(result.key!, [s])));
            c.set("hasAllScopes", (...scopes: string[]) => this.store!.hasScopes(result.key!, scopes));

            await next();
        });

        console.log("✅ API Key feature initialized");
    }

    private shouldSkipPath(path: string): boolean {
        if (!this.config.skipPaths?.length) return false;
        return this.config.skipPaths.some(skip => {
            if (skip.endsWith("*")) return path.startsWith(skip.slice(0, -1));
            return path === skip;
        });
    }

    private extractApiKey(c: Context): string | null {
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
            }
            if (key) return key;
        }
        return null;
    }
}

export function requireApiKey() {
    return async (c: Context, next: Next) => {
        if (!c.get("apiKey")) throw new HTTPException(401, { message: "API key is required" });
        await next();
    };
}

export function requireScope(...scopes: string[]) {
    return async (c: Context, next: Next) => {
        const hasAll = c.get("hasAllScopes");
        if (!c.get("apiKey")) throw new HTTPException(401, { message: "API key is required" });
        if (!hasAll || !hasAll(...scopes)) throw new HTTPException(403, { message: "Insufficient scopes" });
        await next();
    };
}
