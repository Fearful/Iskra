import type { KVAdapter } from './types';

/** setTimeout's limit: a longer delay (a TTL over ~24.8 days) fires at once. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * Lightweight in-memory {@link KVAdapter} used as the default backing store
 * when no adapter is supplied to the {@link Cache} constructor.
 *
 * This is intentionally a thin Map wrapper — it mirrors kv-kit's MemoryAdapter
 * without depending on an unexported internal symbol.
 */
export class MemoryAdapter implements KVAdapter {
    readonly id = 'memory';
    private store = new Map<string, unknown>();
    private timers = new Map<string, ReturnType<typeof setTimeout>>();

    connect(): void {
        // no-op
    }

    disconnect(): void {
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers = new Map();
        this.store = new Map();
    }

    async get<T = unknown>(key: string): Promise<T | undefined> {
        return this.store.get(key) as T | undefined;
    }

    async set<T = unknown>(key: string, value: T, ttl?: number): Promise<void> {
        this.clearTimer(key);
        this.store.set(key, value);
        if (ttl && ttl > 0 && Number.isFinite(ttl)) this.expireIn(key, ttl * 1000);
    }

    /** Arms the expiry timer, in steps when the delay exceeds setTimeout's limit. */
    private expireIn(key: string, ms: number): void {
        const step = Math.min(ms, MAX_TIMEOUT_MS);
        const timer = setTimeout(() => {
            if (ms > step) {
                this.expireIn(key, ms - step);
                return;
            }
            this.store.delete(key);
            this.timers.delete(key);
        }, step);
        timer.unref?.();
        this.timers.set(key, timer);
    }

    async del(key: string): Promise<void> {
        this.clearTimer(key);
        this.store.delete(key);
    }

    private clearTimer(key: string): void {
        const existing = this.timers.get(key);
        if (existing) {
            clearTimeout(existing);
            this.timers.delete(key);
        }
    }

    async has(key: string): Promise<boolean> {
        return this.store.has(key);
    }
}
