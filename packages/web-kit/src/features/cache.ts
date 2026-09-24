import type { Feature, CacheConfig } from "../types";
import type { Kernel } from "../kernel";
import type { Context, Next } from "hono";
import Redis from "ioredis";

// Standard Cache Interface
export interface CacheAdapter {
    get(key: string): Promise<any>;
    set(key: string, value: any, ttl?: number): Promise<void>;
    delete(key: string): Promise<void>;
    exists(key: string): Promise<boolean>;
    increment?(key: string): Promise<number>;
    /**
     * Atomically increments a counter, creating it with `ttlMs` expiry when it
     * does not exist (or has lost its expiry). Used by rate limiting.
     */
    incrementWithTtl?(key: string, ttlMs: number): Promise<number>;
    disconnect?(): Promise<void>;
}

// Simple Memory Adapter
class MemoryAdapter implements CacheAdapter {
    private store = new Map<string, { value: any, expires: number | null }>();

    async get(key: string) {
        const item = this.store.get(key);
        if (!item) return null;
        if (item.expires && item.expires < Date.now()) {
            this.store.delete(key);
            return null;
        }
        return item.value;
    }

    async set(key: string, value: any, ttl?: number) {
        const expires = ttl ? Date.now() + ttl * 1000 : null;
        this.store.set(key, { value, expires });
    }

    async delete(key: string) {
        this.store.delete(key);
    }

    async exists(key: string) {
        return this.store.has(key);
    }

    async increment(key: string): Promise<number> {
        const item = this.store.get(key);
        if (!item || (item.expires && item.expires < Date.now())) {
            return 0;
        }
        const newVal = Number(item.value) + 1;
        item.value = newVal;
        return newVal;
    }

    async incrementWithTtl(key: string, ttlMs: number): Promise<number> {
        const item = this.store.get(key);
        if (!item || (item.expires && item.expires < Date.now())) {
            this.store.set(key, { value: 1, expires: Date.now() + ttlMs });
            return 1;
        }
        item.value = Number(item.value) + 1;
        item.expires ??= Date.now() + ttlMs;
        return item.value;
    }
}

// INCR, then (re)apply the expiry if the key is new or has none, in one atomic step.
const INCREMENT_WITH_TTL_SCRIPT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('PTTL', KEYS[1]) == -1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return n
`;

// Redis Adapter
class RedisAdapter implements CacheAdapter {
    private client: Redis;

    constructor(options: any) {
        this.client = new Redis(options);
    }

    async get(key: string) {
        const value = await this.client.get(key);
        try {
            return value ? JSON.parse(value) : null;
        } catch {
            return value;
        }
    }

    async set(key: string, value: any, ttl?: number) {
        const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
        if (ttl) {
            await this.client.set(key, stringValue, 'EX', ttl);
        } else {
            await this.client.set(key, stringValue);
        }
    }

    async delete(key: string) {
        await this.client.del(key);
    }

    async exists(key: string) {
        const result = await this.client.exists(key);
        return result === 1;
    }

    async increment(key: string): Promise<number> {
        return await this.client.incr(key);
    }

    async incrementWithTtl(key: string, ttlMs: number): Promise<number> {
        return Number(await this.client.eval(INCREMENT_WITH_TTL_SCRIPT, 1, key, Math.max(1, Math.ceil(ttlMs))));
    }

    async disconnect() {
        await this.client.quit();
    }
}

declare module "hono" {
    interface ContextVariableMap {
        cache: CacheAdapter;
    }
}

export class CacheFeature implements Feature {
    name = "cache";
    public client!: CacheAdapter;

    constructor(private config: CacheConfig = { adapter: "memory" }) { }

    async initialize(kernel: Kernel): Promise<void> {
        console.log(`⚙️ Initializing Cache: ${this.config.adapter}`);

        if (this.config.adapter === "redis") {
            const conn = this.config.connection || {};
            try {
                this.client = new RedisAdapter({
                    host: conn.host || "localhost",
                    port: conn.port || 6379,
                    password: conn.password,
                    db: conn.db || 0
                });
            } catch (err) {
                console.warn("⚠️ Redis connection failed, falling back to memory cache");
                this.client = new MemoryAdapter();
            }
        } else {
            this.client = new MemoryAdapter();
        }

        const app = kernel.getApp();
        app.use("*", async (c: Context, next: Next) => {
            c.set("cache", this.client);
            await next();
        });

        console.log('✅ Cache initialized.');
    }

    async shutdown(): Promise<void> {
        if (this.client.disconnect) {
            await this.client.disconnect();
        }
    }
}
