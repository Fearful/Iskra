import type { KVAdapter } from '../types';
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

/** `EX` for whole seconds; `PX` for fractional TTLs, which Redis `EX` rejects. */
function ttlArgs(ttl: number): ['EX', number] | ['PX', number] {
    return Number.isInteger(ttl) ? ['EX', ttl] : ['PX', Math.max(1, Math.round(ttl * 1000))];
}

export class RedisAdapter implements KVAdapter {
    id = 'redis';
    private client: Redis | null = null;
    private readonly options: RedisAdapterOptions;

    constructor(options: RedisAdapterOptions) {
        this.options = options;
    }

    connect() {
        // ioredis only parses a URL passed as its own argument: an object with
        // a `url` key was ignored and it silently connected to localhost:6379.
        if (typeof this.options === 'string') {
            this.client = new Redis(this.options);
        } else if (this.options.url) {
            const { url, ...rest } = this.options;
            this.client = new Redis(url, rest);
        } else {
            this.client = new Redis(this.options);
        }
    }

    async disconnect() {
        const client = this.client;
        this.client = null;
        if (!client) return;
        // QUIT waits for pending replies, so in-flight writes are not dropped.
        if (typeof client.quit === 'function') {
            await client.quit().catch(() => client.disconnect());
        } else {
            client.disconnect();
        }
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
        if (ttl) {
            await this.redis.set(key, val, ...(ttlArgs(ttl) as ['EX', number]));
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

    async mset<T = unknown>(
        entries: Array<[string, T]>,
        ttl?: number
    ): Promise<void> {
        if (entries.length === 0) return;
        const pipeline = this.redis.pipeline();

        for (const [key, value] of entries) {
            const val = encode(value);
            if (ttl) {
                pipeline.set(key, val, ...(ttlArgs(ttl) as ['EX', number]));
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
