import type { App, Driver } from '@iskra-bun/core';
import type { Redis } from 'ioredis';
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
        // Like db-kit's 'db': services look the store up as app.context.get('kv').
        app.context.set('kv', this);
        const config = app.config.kv;

        if (config?.driver === 'redis') {
            app.logger.info('Initializing KV with Redis');
            this.adapter = new RedisAdapter(config.connection ?? {}, {
                onError: (err) => app.logger.warn({ err }, 'KV Redis connection error'),
            });
        } else if (!config?.driver || config.driver === 'memory') {
            app.logger.info('Initializing KV with Memory');
            this.adapter = new MemoryAdapter();
        } else {
            // Unknown drivers (e.g. 'libsql') used to fall back to memory
            // silently, losing every value on restart.
            throw new Error(`Unsupported KV driver "${config.driver}" (supported: "memory", "redis")`);
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

    /**
     * The underlying ioredis client with the "redis" driver, once started: for
     * commands the KV API does not cover (sets, sorted sets, pipelines). It
     * bypasses `namespace` and the JSON codec. `undefined` with the memory
     * driver or before start().
     */
    get client(): Redis | undefined {
        return this.adapter instanceof RedisAdapter ? this.adapter.nativeClient ?? undefined : undefined;
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

    // Batch operations. When the underlying adapter exposes a native batch
    // method, the manager delegates to it (a single round-trip) after applying
    // the namespace prefix; otherwise it falls back to a per-key loop. This
    // keeps the optional adapter methods out of the hot path for adapters that
    // do not implement them while avoiding the N+1 fan-out for those that do.

    async mget<T = unknown>(keys: string[]): Promise<(T | undefined)[]> {
        const prefixed = keys.map(k => this.prefixed(k));

        if (this.adapter.mget) {
            return this.adapter.mget<T>(prefixed);
        }

        return Promise.all(prefixed.map(k => this.adapter.get<T>(k)));
    }

    async mset<T = unknown>(
        entries: Array<[string, T]> | Record<string, T>,
        ttl?: number
    ): Promise<void> {
        const pairs: Array<[string, T]> = Array.isArray(entries)
            ? entries
            : (Object.entries(entries) as Array<[string, T]>);

        const prefixed: Array<[string, T]> = pairs.map(
            ([k, v]) => [this.prefixed(k), v] as [string, T]
        );

        if (this.adapter.mset) {
            await this.adapter.mset<T>(prefixed, ttl);
            return;
        }

        await Promise.all(prefixed.map(([k, v]) => this.adapter.set<T>(k, v, ttl)));
    }

    async mdel(keys: string[]): Promise<void> {
        const prefixed = keys.map(k => this.prefixed(k));

        if (this.adapter.mdel) {
            await this.adapter.mdel(prefixed);
            return;
        }

        await Promise.all(prefixed.map(k => this.adapter.del(k)));
    }
}
