export interface KVAdapter {
    id: string; // 'memory', 'redis', 'libsql'
    connect(): Promise<void> | void;
    disconnect(): Promise<void> | void;

    get<T = unknown>(key: string): Promise<T | undefined>;
    set<T = unknown>(key: string, value: T, ttl?: number): Promise<void>;
    del(key: string): Promise<void>;
    has(key: string): Promise<boolean>;
}
