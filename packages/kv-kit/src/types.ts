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
}
