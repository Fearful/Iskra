import type { Feature, RateLimitConfig } from "../types";
import type { Kernel } from "../kernel";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { getClientIp, type TrustProxy } from "../client-ip";
import { consoleLogger, type KernelLogger } from "../logging";

interface RateLimitStore {
    get(key: string): Promise<number | null>;
    set(key: string, value: number, ttl: number): Promise<void>;
    increment(key: string, ttl: number): Promise<number>;
}

class MemoryStore implements RateLimitStore {
    private store = new Map<string, { count: number; expiresAt: number }>();

    async get(key: string): Promise<number | null> {
        const entry = this.store.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return null;
        }
        return entry.count;
    }

    async set(key: string, value: number, ttl: number): Promise<void> {
        this.store.set(key, { count: value, expiresAt: Date.now() + ttl });
    }

    async increment(key: string, ttl: number): Promise<number> {
        const entry = this.store.get(key);
        if (!entry || Date.now() > entry.expiresAt) {
            this.store.set(key, { count: 1, expiresAt: Date.now() + ttl });
            return 1;
        }
        entry.count++;
        return entry.count;
    }

    cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.store.entries()) {
            if (now > entry.expiresAt) this.store.delete(key);
        }
    }
}

class CacheStoreWrapper implements RateLimitStore {
    constructor(private cache: any) { }

    async get(key: string): Promise<number | null> {
        return await this.cache.get(key);
    }

    async set(key: string, value: number, ttl: number): Promise<void> {
        await this.cache.set(key, value, ttl / 1000); // Cache feature expects seconds typically if using Redis, but check implementation
    }

    async increment(key: string, ttl: number): Promise<number> {
        // Atomic increment that also guarantees an expiry (Redis: one Lua call).
        // A separate GET + INCR lets the key expire in between, and INCR then
        // recreates it without a TTL — blocking that client forever.
        if (this.cache.incrementWithTtl) return await this.cache.incrementWithTtl(key, ttl);

        // Fallback for custom adapters: not atomic, but every write carries a TTL.
        const ttlSeconds = Math.ceil(ttl / 1000);
        const current = await this.cache.get(key);
        const newVal = current === null ? 1 : Number(current) + 1;
        await this.cache.set(key, newVal, ttlSeconds);
        return newVal;
    }
}

export class RateLimitFeature implements Feature {
    name = "rate-limit";
    private log: KernelLogger = consoleLogger;
    /**
     * `store: "cache"` needs the cache feature initialized first; registered
     * after this one, it was not, and limits silently fell back to a
     * per-process memory store.
     */
    dependencies?: string[];
    private config: Required<Omit<RateLimitConfig, "keyGenerator" | "skip" | "handler">> & {
        keyGenerator?: RateLimitConfig["keyGenerator"];
        skip?: RateLimitConfig["skip"];
        handler?: RateLimitConfig["handler"];
    };
    private store?: RateLimitStore;
    private cleanupInterval?: ReturnType<typeof setInterval>;
    private trustProxy?: TrustProxy;
    private warnedUnknownClient = false;

    constructor(config: RateLimitConfig = {}) {
        if (config.store === "cache") this.dependencies = ["cache"];
        this.config = {
            windowMs: config.windowMs || 15 * 60 * 1000,
            max: config.max || 100,
            standardHeaders: config.standardHeaders ?? true,
            store: config.store || "memory",
            keyGenerator: config.keyGenerator,
            skip: config.skip,
            handler: config.handler
        };
    }

    async initialize(kernel: Kernel): Promise<void> {
        this.log = kernel.getLogger();
        this.trustProxy = kernel.getConfig().trustProxy;

        if (this.config.store === "cache") {
            const cacheFeature = kernel.getFeature("cache");
            if (cacheFeature?.client) {
                this.store = new CacheStoreWrapper(cacheFeature.client);
            } else {
                this.log.warn("Cache feature not available for rate-limit, falling back to memory store");
                const mem = new MemoryStore();
                this.store = mem;
                this.cleanupInterval = setInterval(() => mem.cleanup(), 300000);
            }
        }

        if (this.config.store === "memory") {
            const mem = new MemoryStore();
            this.store = mem;
            this.cleanupInterval = setInterval(() => mem.cleanup(), 300000);
        }

        const app = kernel.getApp();
        app.use("*", async (c: Context, next: Next) => {
            await this.middleware(c, next);
        });
        this.log.debug("Rate limit feature initialized");
    }

    private async middleware(c: Context, next: Next) {
        if (this.config.skip && this.config.skip(c)) {
            await next();
            return;
        }

        let store = this.store;
        if (!store && this.config.store === "cache") {
            const cache = c.get("cache");
            if (cache) {
                store = new CacheStoreWrapper(cache);
            } else {
                if (!this.store) {
                    this.store = new MemoryStore(); // Fallback
                    this.cleanupInterval = setInterval(() => (this.store as MemoryStore).cleanup(), 300000);
                }
                store = this.store;
            }
        }

        if (!store) {
            await next();
            return;
        }

        const key = this.config.keyGenerator ? this.config.keyGenerator(c) : this.defaultKeyGenerator(c);
        const rlKey = `rate_limit:${key}`;
        const count = await store.increment(rlKey, this.config.windowMs);

        if (count > this.config.max) {
            if (this.config.handler) return this.config.handler(c);
            throw new HTTPException(429, { message: "Too many requests" });
        }

        if (this.config.standardHeaders) {
            c.header("X-RateLimit-Limit", String(this.config.max));
            c.header("X-RateLimit-Remaining", String(Math.max(0, this.config.max - count)));
            c.header("X-RateLimit-Reset", String(Math.ceil((Date.now() + this.config.windowMs) / 1000)));
        }

        await next();
    }

    private defaultKeyGenerator(c: Context): string {
        const ip = getClientIp(c, this.trustProxy);
        if (ip) return ip;
        if (!this.warnedUnknownClient) {
            this.warnedUnknownClient = true;
            this.log.warn(
                "rate-limit: client IP unavailable (not served by Bun.serve?); all such requests share one bucket. " +
                    "Pass a keyGenerator to identify clients.",
            );
        }
        return "unknown";
    }

    async shutdown() {
        if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    }
}
