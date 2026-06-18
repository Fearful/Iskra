import type { KVAdapter } from '../types';

export class MemoryAdapter implements KVAdapter {
    id = 'memory';
    private store = new Map<string, any>();

    connect() {
        // No-op
    }
    disconnect() {
        this.store.clear();
    }

    async get(key: string) {
        return this.store.get(key);
    }

    async set(key: string, value: any, ttl?: number) {
        this.store.set(key, value);
        if (ttl) {
            setTimeout(() => this.store.delete(key), ttl * 1000);
        }
    }

    async del(key: string) {
        this.store.delete(key);
    }

    async has(key: string) {
        return this.store.has(key);
    }
}
