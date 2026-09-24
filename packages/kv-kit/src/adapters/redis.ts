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

export class RedisAdapter implements KVAdapter {
    id = 'redis';
    private client: Redis | null = null;
    private readonly options: RedisOptions | string;

    constructor(options: RedisOptions | string) {
        this.options = options;
    }

    connect() {
        this.client = new Redis(this.options as RedisOptions);
    }

    disconnect() {
        this.client?.disconnect();
    }

    async get<T = unknown>(key: string): Promise<T | undefined> {
        const val = await this.client?.get(key);
        if (val === null || val === undefined) return undefined;
        return decode<T>(val);
    }

    async set<T = unknown>(key: string, value: T, ttl?: number): Promise<void> {
        const val = encode(value);
        if (ttl) {
            await this.client?.set(key, val, 'EX', ttl);
        } else {
            await this.client?.set(key, val);
        }
    }

    async del(key: string) {
        await this.client?.del(key);
    }

    async has(key: string) {
        const exists = await this.client?.exists(key);
        return exists === 1;
    }

    // Native batch operations. A single MGET / pipelined MSET / variadic DEL
    // replaces the manager's per-key fan-out (avoids the N+1 round-trips).

    async mget<T = unknown>(keys: string[]): Promise<(T | undefined)[]> {
        if (keys.length === 0) return [];
        const raws = (await this.client?.mget(...keys)) ?? [];
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
        const pipeline = this.client?.pipeline();
        if (!pipeline) return;

        for (const [key, value] of entries) {
            const val = encode(value);
            if (ttl) {
                pipeline.set(key, val, 'EX', ttl);
            } else {
                pipeline.set(key, val);
            }
        }

        await pipeline.exec();
    }

    async mdel(keys: string[]): Promise<void> {
        if (keys.length === 0) return;
        await this.client?.del(...keys);
    }
}
