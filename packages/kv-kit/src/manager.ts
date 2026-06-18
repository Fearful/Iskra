import type { App, Driver } from '@iskra-bun/core';
import type { KVAdapter } from './types';
import { MemoryAdapter } from './adapters/memory';
import { RedisAdapter } from './adapters/redis';

export class KVManager implements Driver, KVAdapter {
    name = 'KVManager';
    id = 'manager';
    private app: App | null = null;
    private adapter: KVAdapter;

    constructor() {
        // Default to memory until configured
        this.adapter = new MemoryAdapter();
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

    // Proxy methods
    get(key: string) { return this.adapter.get(key); }
    set(key: string, value: any, ttl?: number) { return this.adapter.set(key, value, ttl); }
    del(key: string) { return this.adapter.del(key); }
    has(key: string) { return this.adapter.has(key); }
}
