import type { App, Driver } from '@iskra-bun/core';
import type { KVAdapter } from './types';
import { MemoryAdapter } from './adapters/memory';
import { RedisAdapter } from './adapters/redis';

export interface KVManagerOptions {
    /**
     * Optional namespace prepended to every key as `"<namespace>:<key>"`.
     * Defaults to `""` (no prefix) to preserve existing behavior.
     */
    namespace?: string;
}

export class KVManager implements Driver, KVAdapter {
    name = 'KVManager';
    id = 'manager';
    private app: App | null = null;
    private adapter: KVAdapter;
    private readonly prefix: string;

    constructor(options: KVManagerOptions = {}) {
        // Default to memory until configured
        this.adapter = new MemoryAdapter();
        this.prefix = options.namespace ? `${options.namespace}:` : '';
    }

    init(app: App) {
        this.app = app;
        const config = app.config.kv;

        if (config?.driver === 'redis') {
            app.logger.info('Initializing KV with Redis');
            this.adapter = new RedisAdapter(config.connection);
        } else {
            app.logger.info('Initializing KV with Memory');
            this.adapter = new MemoryAdapter();
        }
    }

    async connect() {
        await this.adapter.connect();
        this.app?.logger.info('KV Store connected');
    }

    async disconnect() {
        await this.adapter.disconnect();
    }

    // Driver Interface
    async start() {
        await this.connect();
    }

    async stop() {
        await this.disconnect();
    }

    private prefixed(key: string): string {
        return `${this.prefix}${key}`;
    }

    // Proxy methods (namespace-aware)
    get<T = unknown>(key: string): Promise<T | undefined> {
        return this.adapter.get<T>(this.prefixed(key));
    }

    set<T = unknown>(key: string, value: T, ttl?: number): Promise<void> {
        return this.adapter.set<T>(this.prefixed(key), value, ttl);
    }

    del(key: string): Promise<void> {
        return this.adapter.del(this.prefixed(key));
    }

    has(key: string): Promise<boolean> {
        return this.adapter.has(this.prefixed(key));
    }

    // Batch operations — implemented at manager level so KVAdapter stays unchanged
    // and existing implementers (e.g. cache-kit's MemoryAdapter) are unaffected.
    //
    // Follow-up: RedisAdapter could override these with native MGET/MSET for
    // better throughput at scale.

    async mget<T = unknown>(keys: string[]): Promise<(T | undefined)[]> {
        return Promise.all(keys.map(k => this.get<T>(k)));
    }

    async mset<T = unknown>(
        entries: Array<[string, T]> | Record<string, T>,
        ttl?: number
    ): Promise<void> {
        const pairs: Array<[string, T]> = Array.isArray(entries)
            ? entries
            : (Object.entries(entries) as Array<[string, T]>);

        await Promise.all(pairs.map(([k, v]) => this.set<T>(k, v, ttl)));
    }

    async mdel(keys: string[]): Promise<void> {
        await Promise.all(keys.map(k => this.del(k)));
    }
}
