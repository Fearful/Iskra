import type { KVAdapter } from '../types';
import { checkTtl } from '../ttl';
import Redis from 'ioredis';
import type { RedisOptions } from 'ioredis';

/**
 * Single consistent codec shared by every write/read path.
 *
 * `undefined` is guarded explicitly: there is no JSON representation for it,
 * so it is stored as the JSON `null` literal and decoded back to `undefined`
 * on read. Every other value is `JSON.stringify`'d on write and `JSON.parse`'d
 * on read, so the string "123" round-trips as the string "123" (not the number
 * 123) and "{}" round-trips as the string "{}" (not an empty object).
 */
function encode<T>(value: T): string {
    if (value === undefined) return 'null';
    return JSON.stringify(value);
}

function decode<T>(raw: string): T | undefined {
    try {
        const parsed = JSON.parse(raw) as T | null;
        return parsed === null ? undefined : (parsed as T);
    } catch {
        // Tolerate values written outside the adapter that are not valid JSON.
        return raw as unknown as T;
    }
}

/**
 * Connection settings: a `redis://` / `rediss://` URL, ioredis options, or
 * ioredis options with a `url` (the form used in app.config and the docs).
 */
export type RedisAdapterOptions = string | (RedisOptions & { url?: string });

export interface RedisAdapterHooks {
    /**
     * Receives the client's `error` events (a dropped connection, each failed
     * reconnect). Without it they are ignored; ioredis printed them to the
     * console, outside the app's logger.
     */
    onError?: (error: Error) => void;
}

/** `EX` for whole seconds; `PX` for fractional TTLs, which Redis `EX` rejects. */
function ttlArgs(ttl: number): ['EX', number] | ['PX', number] {
    return Number.isInteger(ttl) ? ['EX', ttl] : ['PX', Math.max(1, Math.round(ttl * 1000))];
}

export class RedisAdapter implements KVAdapter {
    id = 'redis';
    private client: Redis | null = null;
    private readonly options: RedisAdapterOptions;
    private readonly hooks: RedisAdapterHooks;

    constructor(options: RedisAdapterOptions, hooks: RedisAdapterHooks = {}) {
        this.options = options;
        this.hooks = hooks;
    }

    /**
     * Connects and waits for Redis to answer: an unreachable server or a wrong
     * password fails here (and so the app's start) instead of on the first
     * command. Once connected, a dropped connection is retried by ioredis.
     */
    async connect() {
        // ioredis only parses a URL passed as its own argument: an object with
        // a `url` key was ignored and it silently connected to localhost:6379.
        let client: Redis;
        if (typeof this.options === 'string') {
            client = new Redis(this.options, { lazyConnect: true });
        } else if (this.options.url) {
            const { url, ...rest } = this.options;
            client = new Redis(url, { ...rest, lazyConnect: true });
        } else {
            client = new Redis({ ...this.options, lazyConnect: true });
        }
        client.on('error', (error: Error) => this.hooks.onError?.(error));
        try {
            await client.connect();
        } catch (error) {
            client.disconnect();
            // The message, not the URL: it may carry the password.
            throw new Error(`Could not connect to Redis: ${error instanceof Error ? error.message : String(error)}`, {
                cause: error,
            });
        }
        this.client = client;
    }

    /** Longest wait for QUIT before the connection is closed anyway. */
    protected quitTimeoutMs = 2000;

    /**
     * Closes the connection. When connected, QUIT lets pending replies arrive
     * (in-flight writes are not dropped), for at most `quitTimeoutMs`. When the
     * connection is down, ioredis would queue QUIT behind the offline queue and
     * resolve only after its reconnect attempts run out (about 10 s by default,
     * never with `maxRetriesPerRequest: null`), eating the app's shutdown
     * timeout: the client is closed at once instead.
     */
    async disconnect() {
        const client = this.client;
        this.client = null;
        if (!client) return;
        if (typeof client.quit !== 'function' || client.status !== 'ready') {
            client.disconnect();
            return;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timedOut = new Promise<'timeout'>((resolve) => {
            timer = setTimeout(() => resolve('timeout'), this.quitTimeoutMs);
        });
        const outcome = await Promise.race([
            client.quit().then(
                () => 'quit' as const,
                () => 'error' as const,
            ),
            timedOut,
        ]);
        clearTimeout(timer);
        if (outcome !== 'quit') client.disconnect();
    }

    /** The ioredis client once connected (null before connect() and after disconnect()). */
    get nativeClient(): Redis | null {
        return this.client;
    }

    /** The live client; operations before connect() fail instead of silently doing nothing. */
    private get redis(): Redis {
        if (!this.client) throw new Error('RedisAdapter is not connected; call connect() first');
        return this.client;
    }

    async get<T = unknown>(key: string): Promise<T | undefined> {
        const val = await this.redis.get(key);
        if (val === null || val === undefined) return undefined;
        return decode<T>(val);
    }

    async set<T = unknown>(key: string, value: T, ttl?: number): Promise<void> {
        const val = encode(value);
        const seconds = checkTtl(ttl);
        if (seconds !== undefined) {
            await this.redis.set(key, val, ...(ttlArgs(seconds) as ['EX', number]));
        } else {
            await this.redis.set(key, val);
        }
    }

    async del(key: string) {
        await this.redis.del(key);
    }

    async has(key: string) {
        const exists = await this.redis.exists(key);
        return exists === 1;
    }

    // Native batch operations. A single MGET / pipelined MSET / variadic DEL
    // replaces the manager's per-key fan-out (avoids the N+1 round-trips).

    async mget<T = unknown>(keys: string[]): Promise<(T | undefined)[]> {
        if (keys.length === 0) return [];
        const raws = (await this.redis.mget(...keys)) ?? [];
        return keys.map((_, i) => {
            const raw = raws[i];
            return raw === null || raw === undefined ? undefined : decode<T>(raw);
        });
    }

    async mset<T = unknown>(entries: Array<[string, T]>, ttl?: number): Promise<void> {
        const seconds = checkTtl(ttl);
        if (entries.length === 0) return;
        const pipeline = this.redis.pipeline();

        for (const [key, value] of entries) {
            const val = encode(value);
            if (seconds !== undefined) {
                pipeline.set(key, val, ...(ttlArgs(seconds) as ['EX', number]));
            } else {
                pipeline.set(key, val);
            }
        }

        // exec() resolves even when individual commands fail; surface them.
        const results = await pipeline.exec();
        const failed = results?.find(([err]) => err);
        if (failed) throw failed[0];
    }

    async mdel(keys: string[]): Promise<void> {
        if (keys.length === 0) return;
        await this.redis.del(...keys);
    }
}
