export interface KVAdapter {
    id: string; // 'memory', 'redis', 'libsql'
    connect(): Promise<void> | void;
    disconnect(): Promise<void> | void;

    get<T = unknown>(key: string): Promise<T | undefined>;
    set<T = unknown>(key: string, value: T, ttl?: number): Promise<void>;
    del(key: string): Promise<void>;
    has(key: string): Promise<boolean>;

    // Optional native batch operations. When an adapter implements these, the
    // KVManager prefers them over a per-key loop to avoid N+1 round-trips.
    // Adapters that omit them remain fully compatible.
    //
    // Storing `null`/`undefined` is normalized to "absent" by the adapters that
    // round-trip through JSON (see RedisAdapter); the in-memory adapter stores
    // them verbatim. Callers should treat `null`/`undefined` values as
    // undefined behavior and avoid relying on either form being preserved.
    mget?<T = unknown>(keys: string[]): Promise<(T | undefined)[]>;
    mset?<T = unknown>(entries: Array<[string, T]>, ttl?: number): Promise<void>;
    mdel?(keys: string[]): Promise<void>;

    /**
     * Deletes every key that starts with `prefix` (every key the adapter holds
     * without one), without touching the connection. An adapter that cannot
     * leaves it out, and callers such as cache-kit's `clear()` then fail.
     */
    clear?(prefix?: string): Promise<void>;

    /**
     * Expiring sets, for cache-kit's tag index: `sadd` adds `member` to the set
     * at `key` for `ttl` seconds (for good without one), and the set lives as
     * long as its longest-lived member. `sdrain` deletes the set and returns
     * its unexpired members in one step, so a member added meanwhile is never lost.
     */
    sadd?(key: string, member: string, ttl?: number): Promise<void>;
    sdrain?(key: string): Promise<string[]>;
}
