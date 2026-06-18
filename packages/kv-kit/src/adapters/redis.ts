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

    async get(key: string) {
        const val = await this.client?.get(key);
        try {
            return val ? JSON.parse(val) : null;
        } catch {
            return val;
        }
    }

    async set(key: string, value: any, ttl?: number) {
        const val = typeof value === 'object' ? JSON.stringify(value) : value;
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
