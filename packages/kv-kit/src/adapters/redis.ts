import type { KVAdapter } from '../types';
import Redis from 'ioredis';

export class RedisAdapter implements KVAdapter {
    id = 'redis';
    private client: Redis | null = null;
    private options: any;

    constructor(options: any) {
        this.options = options;
    }

    connect() {
        this.client = new Redis(this.options);
    }

    disconnect() {
        this.client?.disconnect();
    }

    async get<T = unknown>(key: string): Promise<T | undefined> {
        const val = await this.client?.get(key);
        if (val === null || val === undefined) return undefined;
        try {
            return JSON.parse(val) as T;
        } catch {
            return val as unknown as T;
        }
    }

    async set<T = unknown>(key: string, value: T, ttl?: number): Promise<void> {
        const val = typeof value === 'object' ? JSON.stringify(value) : String(value);
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
}
