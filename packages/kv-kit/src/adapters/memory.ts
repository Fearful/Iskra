import type { KVAdapter } from '../types';

export class MemoryAdapter implements KVAdapter {
    id = 'memory';
    private store = new Map<string, unknown>();
    private timers = new Map<string, ReturnType<typeof setTimeout>>();

    connect() {
        // No-op
    }

    disconnect() {
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
        this.store.clear();
    }

    async get<T = unknown>(key: string): Promise<T | undefined> {
        return this.store.get(key) as T | undefined;
    }

    async set<T = unknown>(key: string, value: T, ttl?: number): Promise<void> {
        // Note: storing `null`/`undefined` is undefined behavior across adapters.
        // This in-memory adapter stores the value verbatim (so `get` returns it
        // as-is), whereas the RedisAdapter normalizes both to "absent" because
        // they have no faithful JSON round-trip. Callers should not depend on
        // either form being preserved.
        //
        // Clear any existing expiry timer for this key before setting a new one
        const existing = this.timers.get(key);
        if (existing !== undefined) {
            clearTimeout(existing);
            this.timers.delete(key);
        }

        this.store.set(key, value);

        if (ttl) {
            const timer = setTimeout(() => {
                this.store.delete(key);
                this.timers.delete(key);
            }, ttl * 1000);

            // Avoid keeping the process alive just for expiry timers
            timer.unref?.();

            this.timers.set(key, timer);
        }
    }

    async del(key: string): Promise<void> {
        const timer = this.timers.get(key);
        if (timer !== undefined) {
            clearTimeout(timer);
            this.timers.delete(key);
        }
        this.store.delete(key);
    }

    async has(key: string): Promise<boolean> {
        return this.store.has(key);
    }
}
