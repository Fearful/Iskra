import type { Feature, RateLimitConfig } from '../types';
import type { Kernel } from '../kernel';
import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { clientIpKey, getClientIp, type ClientIpHeader, type TrustProxy } from '../client-ip';
import { DEFAULT_MAX_KEYS, HitCounter, retryAfterSeconds } from '../hit-counter';
import { consoleLogger, type KernelLogger } from '../logging';
import type { CacheAdapter } from './cache';

interface RateLimitStore {
    /**
     * Counts a hit for `key` and returns the count in its current window of
     * `ttl` ms, and when that window ends (epoch ms) if the store knows it.
     */
    increment(key: string, ttl: number): Promise<{ count: number; resetAt?: number }>;
}

class MemoryStore implements RateLimitStore {
    constructor(private counter: HitCounter) {}

    async increment(key: string, ttl: number): Promise<{ count: number; resetAt?: number }> {
        const count = this.counter.hit(key, ttl);
        return { count, resetAt: this.counter.resetAt(key) };
    }
}

class CacheStoreWrapper implements RateLimitStore {
    constructor(private cache: CacheAdapter) {}

    async increment(key: string, ttl: number): Promise<{ count: number; resetAt?: number }> {
        const count = await this.count(key, ttl);
        // The cache does not report a key's expiry. The first hit starts the
        // window, so it ends at now + ttl; for later hits the header falls
        // back to now + windowMs, an upper bound of the real reset.
        return { count, resetAt: count === 1 ? Date.now() + ttl : undefined };
    }

    private async count(key: string, ttl: number): Promise<number> {
        // Atomic increment that also guarantees an expiry (Redis: one Lua call).
        // A separate GET + INCR lets the key expire in between, and INCR then
        // recreates it without a TTL — blocking that client forever.
        if (this.cache.incrementWithTtl) return await this.cache.incrementWithTtl(key, ttl);

        // Fallback for custom adapters: not atomic, but every write carries a TTL.
        const ttlSeconds = Math.ceil(ttl / 1000);
        const current = await this.cache.get(key);
        const newVal = current === null ? 1 : Number(current) + 1;
        await this.cache.set(key, newVal, ttlSeconds);
        return newVal;
    }
}

export class RateLimitFeature implements Feature {
    name = 'rate-limit';
    private log: KernelLogger = consoleLogger;
    /**
     * `store: "cache"` needs the cache feature initialized first; registered
     * after this one, it was not, and limits silently fell back to a
     * per-process memory store.
     */
    dependencies?: string[];
    private config: Required<Omit<RateLimitConfig, 'name' | 'keyGenerator' | 'skip' | 'handler'>> & {
        keyGenerator?: RateLimitConfig['keyGenerator'];
        skip?: RateLimitConfig['skip'];
        handler?: RateLimitConfig['handler'];
    };
    private store?: RateLimitStore;
    private counter?: HitCounter;
    private trustProxy?: TrustProxy;
    private clientIpHeader?: ClientIpHeader;
    private warnedUnknownClient = false;

    /** Store key prefix; a named limiter gets its own, so two never share counters. */
    private keyPrefix = 'rate_limit:';

    constructor(config: RateLimitConfig = {}) {
        if (config.name && config.name !== this.name) {
            this.name = config.name;
            this.keyPrefix = `rate_limit:${config.name}:`;
        }
        if (config.store === 'cache') this.dependencies = ['cache'];
        this.config = {
            windowMs: config.windowMs || 15 * 60 * 1000,
            max: config.max || 100,
            standardHeaders: config.standardHeaders ?? true,
            store: config.store || 'memory',
            maxKeys: config.maxKeys || DEFAULT_MAX_KEYS,
            keyGenerator: config.keyGenerator,
            skip: config.skip,
            handler: config.handler,
        };
    }

    /** The memory store, bounded to `maxKeys` clients. */
    private memoryStore(): RateLimitStore {
        this.counter ??= new HitCounter(this.config.maxKeys);
        return new MemoryStore(this.counter);
    }

    async initialize(kernel: Kernel): Promise<void> {
        this.log = kernel.getLogger();
        this.trustProxy = kernel.getConfig().trustProxy;
        this.clientIpHeader = kernel.getConfig().clientIpHeader;

        if (this.config.store === 'cache') {
            const cacheFeature = kernel.getFeature('cache');
            if (cacheFeature?.client) {
                this.store = new CacheStoreWrapper(cacheFeature.client);
            } else {
                this.log.warn('Cache feature not available for rate-limit, falling back to memory store');
                this.store = this.memoryStore();
            }
        }

        if (this.config.store === 'memory') {
            this.store = this.memoryStore();
        }

        const app = kernel.getApp();
        app.use('*', async (c: Context, next: Next) => {
            await this.middleware(c, next);
        });
        this.log.debug('Rate limit feature initialized');
    }

    private async middleware(c: Context, next: Next) {
        if (this.config.skip && this.config.skip(c)) {
            await next();
            return;
        }

        // initialize() always sets it before registering this middleware.
        const store = this.store!;

        const key = this.config.keyGenerator ? this.config.keyGenerator(c) : this.defaultKeyGenerator(c);
        const rlKey = `${this.keyPrefix}${key}`;
        const { count, resetAt } = await store.increment(rlKey, this.config.windowMs);

        if (count > this.config.max) {
            // Set on the context, so the error handler's response carries it
            // (and a custom handler's, when it answers through `c`).
            c.header('Retry-After', retryAfterSeconds(resetAt, this.config.windowMs));
            if (this.config.handler) return this.config.handler(c);
            throw new HTTPException(429, { message: 'Too many requests' });
        }

        if (this.config.standardHeaders) {
            c.header('X-RateLimit-Limit', String(this.config.max));
            c.header('X-RateLimit-Remaining', String(Math.max(0, this.config.max - count)));
            c.header('X-RateLimit-Reset', String(Math.ceil((resetAt ?? Date.now() + this.config.windowMs) / 1000)));
        }

        await next();
    }

    private defaultKeyGenerator(c: Context): string {
        const ip = getClientIp(c, this.trustProxy, this.clientIpHeader);
        if (ip) return clientIpKey(ip);
        if (!this.warnedUnknownClient) {
            this.warnedUnknownClient = true;
            this.log.warn(
                'rate-limit: client IP unavailable (not served by Bun.serve?); all such requests share one bucket. ' +
                    'Pass a keyGenerator to identify clients.',
            );
        }
        return 'unknown';
    }

    async shutdown() {
        this.counter?.dispose();
    }
}
