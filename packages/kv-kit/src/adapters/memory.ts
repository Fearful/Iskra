import type { KVAdapter } from '../types';
import { checkTtl } from '../ttl';

/** setTimeout's limit: a longer delay (a TTL over ~24.8 days) fires at once. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** An expiring set: each member's expiry (ms since the epoch, Infinity for none). */
interface ExpiringSet {
    members: Map<string, number>;
    expiresAt: number;
    /** Size at which expired members are next dropped. */
    pruneAt: number;
}

export class MemoryAdapter implements KVAdapter {
    id = 'memory';
    private store = new Map<string, unknown>();
    private sets = new Map<string, ExpiringSet>();
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
        this.sets.clear();
    }

    // Values are copied in and out, as Redis does: a stored object returned by
    // reference let one request's mutation show up in every other one.
    async get<T = unknown>(key: string): Promise<T | undefined> {
        return structuredClone(this.store.get(key)) as T | undefined;
    }

    async set<T = unknown>(key: string, value: T, ttl?: number): Promise<void> {
        const seconds = checkTtl(ttl);
        const copy = structuredClone(value);
        // Note: storing `null`/`undefined` is undefined behavior across adapters.
        // This in-memory adapter stores the value verbatim (so `get` returns it
        // as-is), whereas the RedisAdapter normalizes both to "absent" because
        // they have no faithful JSON round-trip. Callers should not depend on
        // either form being preserved.
        //
        // Clear any existing expiry timer for this key before setting a new one
        this.clearTimer(key);
        this.sets.delete(key);
        this.store.set(key, copy);

        if (seconds !== undefined) this.expireIn(key, seconds * 1000);
    }

    /** Arms the expiry timer, in steps when the delay exceeds setTimeout's limit. */
    private expireIn(key: string, ms: number) {
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

        // Avoid keeping the process alive just for expiry timers
        timer.unref?.();

        this.timers.set(key, timer);
    }

    private clearTimer(key: string) {
        const timer = this.timers.get(key);
        if (timer !== undefined) {
            clearTimeout(timer);
            this.timers.delete(key);
        }
    }

    async del(key: string): Promise<void> {
        this.clearTimer(key);
        this.store.delete(key);
        this.sets.delete(key);
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
        const seconds = checkTtl(ttl);
        const now = Date.now();
        const expiresAt = seconds === undefined ? Infinity : now + seconds * 1000;
        let set = this.sets.get(key);
        if (!set) {
            this.store.delete(key);
            set = { members: new Map(), expiresAt: 0, pruneAt: 64 };
            this.sets.set(key, set);
        }
        // A member keeps its latest expiry: dropped earlier, an entry written
        // with a longer TTL would survive an invalidation of its tag.
        set.members.set(member, Math.max(set.members.get(member) ?? 0, expiresAt));
        // Expired members go each time the set doubles: O(1) per add on average.
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
