import type { KVAdapter } from './types';

/** setTimeout's limit: a longer delay (a TTL over ~24.8 days) fires at once. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** An expiring set: each member's expiry (ms since the epoch, Infinity for none). */
interface ExpiringSet {
    members: Map<string, number>;
    expiresAt: number;
    /** Size at which expired members are next dropped. */
    pruneAt: number;
}

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
    private sets = new Map<string, ExpiringSet>();
    private timers = new Map<string, ReturnType<typeof setTimeout>>();

    connect(): void {
        // no-op
    }

    disconnect(): void {
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers = new Map();
        this.store = new Map();
        this.sets = new Map();
    }

    async get<T = unknown>(key: string): Promise<T | undefined> {
        return this.store.get(key) as T | undefined;
    }

    async set<T = unknown>(key: string, value: T, ttl?: number): Promise<void> {
        this.clearTimer(key);
        this.sets.delete(key);
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
            this.sets.delete(key);
            this.timers.delete(key);
        }, step);
        timer.unref?.();
        this.timers.set(key, timer);
    }

    async del(key: string): Promise<void> {
        this.clearTimer(key);
        this.store.delete(key);
        this.sets.delete(key);
    }

    private clearTimer(key: string): void {
        const existing = this.timers.get(key);
        if (existing) {
            clearTimeout(existing);
            this.timers.delete(key);
        }
    }

    async has(key: string): Promise<boolean> {
        return this.store.has(key) || this.sets.has(key);
    }

    async clear(prefix = ''): Promise<void> {
        for (const key of [...this.store.keys(), ...this.sets.keys()]) {
            if (key.startsWith(prefix)) await this.del(key);
        }
    }

    async sadd(key: string, member: string, ttl?: number): Promise<void> {
        const now = Date.now();
        const expiresAt = ttl && ttl > 0 && Number.isFinite(ttl) ? now + ttl * 1000 : Infinity;
        let set = this.sets.get(key);
        if (!set) {
            this.store.delete(key);
            set = { members: new Map(), expiresAt: 0, pruneAt: 64 };
            this.sets.set(key, set);
        }
        // A member keeps its latest expiry, and expired members go each time
        // the set doubles (O(1) per add on average), as in kv-kit.
        set.members.set(member, Math.max(set.members.get(member) ?? 0, expiresAt));
        if (set.members.size >= set.pruneAt) {
            for (const [name, at] of set.members) if (at <= now) set.members.delete(name);
            set.pruneAt = Math.max(64, set.members.size * 2);
        }
        if (expiresAt > set.expiresAt) {
            set.expiresAt = expiresAt;
            this.clearTimer(key);
            if (expiresAt !== Infinity) this.expireIn(key, expiresAt - now);
        }
    }

    async sdrain(key: string): Promise<string[]> {
        const set = this.sets.get(key);
        if (!set) return [];
        this.sets.delete(key);
        this.clearTimer(key);
        const now = Date.now();
        return [...set.members].filter(([, at]) => at > now).map(([name]) => name);
    }
}
