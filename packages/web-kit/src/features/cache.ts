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
    /**
     * Increments a counter, creating it at 1. Store a counter as a number
     * (`set(key, 5)`): on Redis the string `'5'` is stored as JSON (`"5"`),
     * which `INCR` refuses.
     */
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

    // Values go in and out as copies, as through Redis: the stored object
    // itself let one request's change to a cached value reach every other.
    async get(key: string) {
        const item = this.live(key);
        return item ? structuredClone(item.value) : null;
    }

    async set(key: string, value: unknown, ttl?: number) {
        const expires = ttl ? Date.now() + ttl * 1000 : null;
        this.put(key, { value: structuredClone(value), expires });
    }

    async setIfExists(key: string, value: unknown, ttl?: number) {
        if (!this.live(key)) return false;
        this.put(key, { value: structuredClone(value), expires: ttl ? Date.now() + ttl * 1000 : null });
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
            // Created at 1, as Redis INCR does (it returned 0 and stored nothing).
            this.put(key, { value: 1, expires: null });
            return 1;
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

/**
 * A TTL in seconds as whole milliseconds, at least 1: `EX` takes only whole
 * seconds, so Redis rejected a fractional TTL the memory adapter honored.
 */
function ttlMs(ttlSeconds: number): number {
    return Math.max(1, Math.ceil(ttlSeconds * 1000));
}

/** How long a Redis command may take unless `CacheConfig.commandTimeoutMs` says otherwise. */
const DEFAULT_COMMAND_TIMEOUT_MS = 2000;

/**
 * ioredis errors carry the command they answer with its arguments: AUTH's
 * password on a refused login, which would then be logged. Only the command
 * name is kept.
 */
function withoutCommandArgs<E>(error: E): E {
    const command = (error as { command?: { name?: unknown; args?: unknown } } | null)?.command;
    if (command && typeof command === 'object' && 'args' in command) {
        (error as { command: unknown }).command = { name: command.name };
    }
    return error;
}

/**
 * The ioredis client options for a CacheConfig, and its URL if it has one.
 * ioredis only parses a URL passed as its own argument (a `url` key in the
 * options is ignored); fields the URL leaves out are taken from the options.
 */
export function redisClientArgs(config: CacheConfig): { url?: string; options: RedisOptions } {
    const { url, tls, host, port, username, password, db } = config.connection ?? {};
    const options: RedisOptions = {
        // ioredis' own defaults, except that a URL brings its own.
        ...(url ? {} : { host: host || 'localhost', port: port || 6379, db: db || 0 }),
        ...(url && host !== undefined && { host }),
        ...(url && port !== undefined && { port }),
        ...(url && db !== undefined && { db }),
        ...(username !== undefined && { username }),
        ...(password !== undefined && { password }),
        ...(tls && { tls: tls === true ? {} : tls }),
        // Fail a command after this long instead of queueing it through every
        // reconnect attempt: during an outage a request that used the cache
        // hung, then failed anyway.
        commandTimeout: config.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
        maxRetriesPerRequest: 1,
    };
    return { url, options };
}

// Redis Adapter
class RedisAdapter implements CacheAdapter {
    private client: Redis;
    private reportedOutage = false;

    constructor(config: CacheConfig, log: KernelLogger) {
        const { url, options } = redisClientArgs(config);
        this.client = url ? new Redis(url, options) : new Redis(options);
        // Without an 'error' listener ioredis printed every failed reconnect
        // to the console, outside the app's logger. One warning per outage.
        this.client.on('error', (error: Error) => {
            if (this.reportedOutage) return;
            this.reportedOutage = true;
            log.warn('Cache: Redis connection error; retrying in the background', withoutCommandArgs(error));
        });
        this.client.on('ready', () => {
            if (this.reportedOutage) log.info('Cache: Redis connection restored');
            this.reportedOutage = false;
        });
    }

    /** The ioredis client's options, for tests and diagnostics. */
    get clientOptions(): Readonly<RedisOptions> {
        return this.client.options;
    }

    async get(key: string) {
        const value = await this.client.get(key);
        try {
            return value ? JSON.parse(value) : null;
        } catch {
            // A raw string an older version stored (it wrote strings as they were).
            return value;
        }
    }

    // Every value is written as JSON, strings too: a raw '123' came back from
    // get() as the number 123, unlike the memory adapter.
    async set(key: string, value: unknown, ttl?: number) {
        const stringValue = JSON.stringify(value);
        if (ttl) {
            await this.client.set(key, stringValue, 'PX', ttlMs(ttl));
        } else {
            await this.client.set(key, stringValue);
        }
    }

    async setIfExists(key: string, value: unknown, ttl?: number) {
        const stringValue = JSON.stringify(value);
        const result = ttl
            ? await this.client.set(key, stringValue, 'PX', ttlMs(ttl), 'XX')
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
            // ioredis connects in the background: the constructor never throws.
            this.client = new RedisAdapter(this.config, this.log);
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
        // No client when initialize() never ran (another feature failed first).
        await this.client?.disconnect?.();
    }
}
