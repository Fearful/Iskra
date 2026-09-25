import type { Feature, CacheConfig } from '../types';
import type { Kernel } from '../kernel';
import type { Context, Next } from 'hono';
import Redis, { type RedisOptions } from 'ioredis';
import { consoleLogger, type KernelLogger } from '../logging';

/**
 * Standard cache interface. Values are JSON-serializable: what get() returns
 * is whatever was set, so narrow it where it is read.
 */
export interface CacheAdapter {
    /** The stored value, or null when missing or expired. */
    get(key: string): Promise<unknown>;
    /** `ttl` in seconds. */
    set(key: string, value: unknown, ttl?: number): Promise<void>;
    /**
     * Like set(), but only if the key exists (and has not expired), checked
     * and written atomically (Redis: `SET ... XX`); whether it was written.
     * Used by the cache session store, so a save cannot re-create a session
     * that another request deleted.
     */
    setIfExists?(key: string, value: unknown, ttl?: number): Promise<boolean>;
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

/** Most entries the memory adapter keeps unless `CacheConfig.maxEntries` says otherwise. */
const DEFAULT_MAX_ENTRIES = 100_000;

type MemoryEntry = { value: unknown; expires: number | null };

/**
 * Expired entries used to be removed only when read again, so keys written
 * once (a rate-limit counter per client) piled up for good. They are swept
 * every minute, and past `maxEntries` the oldest writes are dropped.
 */
class MemoryAdapter implements CacheAdapter {
    private store = new Map<string, MemoryEntry>();
    private sweeper: ReturnType<typeof setInterval>;
    private readonly maxEntries: number;

    constructor(maxEntries: number = DEFAULT_MAX_ENTRIES) {
        this.maxEntries = Math.max(1, Math.floor(maxEntries) || DEFAULT_MAX_ENTRIES);
        this.sweeper = setInterval(() => this.sweep(), 60_000);
        // A cache nobody shut down must not keep the process alive.
        this.sweeper.unref?.();
    }

    /** The entry, unless missing or expired (an expired one is removed). */
    private live(key: string): MemoryEntry | undefined {
        const item = this.store.get(key);
        if (item?.expires && item.expires < Date.now()) {
            this.store.delete(key);
            return undefined;
        }
        return item;
    }

    /** Writes an entry last in the Map's order, so its first keys are the oldest writes. */
    private put(key: string, entry: MemoryEntry): void {
        this.store.delete(key);
        this.store.set(key, entry);
        for (const oldest of this.store.keys()) {
            if (this.store.size <= this.maxEntries) break;
            this.store.delete(oldest);
        }
    }

    private sweep(): void {
        const now = Date.now();
        for (const [key, item] of this.store) {
            if (item.expires && item.expires < now) this.store.delete(key);
        }
    }

    async get(key: string) {
        const item = this.live(key);
        return item ? item.value : null;
    }

    async set(key: string, value: unknown, ttl?: number) {
        const expires = ttl ? Date.now() + ttl * 1000 : null;
        this.put(key, { value, expires });
    }

    async setIfExists(key: string, value: unknown, ttl?: number) {
        if (!this.live(key)) return false;
        this.put(key, { value, expires: ttl ? Date.now() + ttl * 1000 : null });
        return true;
    }

    async delete(key: string) {
        this.store.delete(key);
    }

    async exists(key: string) {
        return this.live(key) !== undefined;
    }

    async increment(key: string): Promise<number> {
        const item = this.live(key);
        if (!item) {
            return 0;
        }
        const newVal = Number(item.value) + 1;
        item.value = newVal;
        return newVal;
    }

    async incrementWithTtl(key: string, ttlMs: number): Promise<number> {
        const item = this.live(key);
        if (!item) {
            this.put(key, { value: 1, expires: Date.now() + ttlMs });
            return 1;
        }
        const next = Number(item.value) + 1;
        item.value = next;
        item.expires ??= Date.now() + ttlMs;
        return next;
    }

    async disconnect() {
        clearInterval(this.sweeper);
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

    constructor(options: RedisOptions) {
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

    async set(key: string, value: unknown, ttl?: number) {
        const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
        if (ttl) {
            await this.client.set(key, stringValue, 'EX', ttl);
        } else {
            await this.client.set(key, stringValue);
        }
    }

    async setIfExists(key: string, value: unknown, ttl?: number) {
        const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
        const result = ttl
            ? await this.client.set(key, stringValue, 'EX', ttl, 'XX')
            : await this.client.set(key, stringValue, 'XX');
        return result === 'OK';
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

declare module 'hono' {
    interface ContextVariableMap {
        cache: CacheAdapter;
    }
}

export class CacheFeature implements Feature {
    name = 'cache';
    private log: KernelLogger = consoleLogger;
    public client!: CacheAdapter;

    constructor(private config: CacheConfig = { adapter: 'memory' }) {}

    async initialize(kernel: Kernel): Promise<void> {
        this.log = kernel.getLogger();
        this.log.debug(`Initializing Cache: ${this.config.adapter}`);

        if (this.config.adapter === 'redis') {
            const conn = this.config.connection || {};
            try {
                this.client = new RedisAdapter({
                    host: conn.host || 'localhost',
                    port: conn.port || 6379,
                    password: conn.password,
                    db: conn.db || 0,
                });
            } catch {
                this.log.warn('Redis connection failed, falling back to memory cache');
                this.client = new MemoryAdapter(this.config.maxEntries);
            }
        } else {
            this.client = new MemoryAdapter(this.config.maxEntries);
        }

        const app = kernel.getApp();
        app.use('*', async (c: Context, next: Next) => {
            c.set('cache', this.client);
            await next();
        });

        this.log.debug('Cache initialized');
    }

    async shutdown(): Promise<void> {
        if (this.client.disconnect) {
            await this.client.disconnect();
        }
    }
}
