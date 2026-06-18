export interface KVAdapter {
    id: string; // 'memory', 'redis', 'libsql'
    connect(): Promise<void> | void;
    disconnect(): Promise<void> | void;

    get(key: string): Promise<any>;
    set(key: string, value: any, ttl?: number): Promise<void>;
    del(key: string): Promise<void>;
    has(key: string): Promise<boolean>;
}
