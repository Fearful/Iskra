import { MemoryAdapter } from './memory-adapter';
import type { KVAdapter, CacheOptions, SetOptions } from './types';

/** Internal prefix used for the tag→keys index stored in the KV adapter. */
const TAG_INDEX_PREFIX = '__cache_tag__:';

/** Keys that enable prototype-pollution when an object is later deep-merged. */
const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'] as const;

class PollutionError extends Error {}

/** Pending tag-index updates per adapter (shared by its namespaced caches) and key. */
const indexLocks = new WeakMap<object, Map<string, Promise<unknown>>>();

/** Runs `fn` after the previous `fn` for the same adapter and key has settled. */
function withLock<T>(adapter: object, key: string, fn: () => Promise<T>): Promise<T> {
    let locks = indexLocks.get(adapter);
    if (!locks) indexLocks.set(adapter, (locks = new Map()));
    const previous = locks.get(key) ?? Promise.resolve();
    const result = previous.then(fn, fn);
    const settled = result.then(
        () => undefined,
        () => undefined,
    );
    locks.set(key, settled);
    void settled.then(() => {
        if (locks.get(key) === settled) locks.delete(key);
    });
    return result;
}

/**
 * Parses cached JSON, throwing if any object in it carries a
 * prototype-pollution key. Cached payloads can originate from untrusted
 * writers; rejecting these keys at the parse boundary stops a malicious value
 * from reaching code that deep-merges it. The reviver sees every key as
 * parsed, so an escaped spelling such as `"\u005f_proto__"` is caught too
 * (a check of the raw text for `"__proto__"` missed it).
 */
function parseSafely(raw: string): unknown {
    return JSON.parse(raw, function (key, value) {
        if ((DANGEROUS_KEYS as readonly string[]).includes(key)) {
            throw new PollutionError(
                `cache-kit: refusing to deserialize value containing the ` +
                    `unsafe key "${key}" (prototype-pollution risk).`,
            );
        }
        return value;
    });
}

/**
 * Cache — higher-level application cache backed by any {@link KVAdapter}.
 *
 * Works out of the box with zero config (defaults to an in-memory adapter).
 * Compose with any kv-kit adapter (MemoryAdapter, RedisAdapter) for production.
 *
 * @example
 * ```ts
 * const cache = new Cache();
 * await cache.set('user:1', { name: 'Alice' }, { ttl: 300 });
 * const user = await cache.get<User>('user:1');
 *
 * // Cache-aside pattern
 * const data = await cache.remember('expensive', 60, () => fetchFromDB());
 *
 * // Namespace isolation
 * const userCache = cache.namespace('users');
 * const postCache = cache.namespace('posts');
 *
 * // Tag-based invalidation
 * await cache.set('item:1', data, { ttl: 60, tags: ['items'] });
 * await cache.invalidateTag('items'); // removes all tagged entries
 * ```
 */
export class Cache {
    private readonly adapter: KVAdapter;
    private readonly prefix: string;
    private readonly defaultTtl: number | undefined;

    constructor(adapter?: KVAdapter, options: CacheOptions = {}) {
        this.adapter = adapter ?? new MemoryAdapter();
        this.prefix = options.namespace ? `${options.namespace}:` : '';
        this.defaultTtl = options.defaultTtl;
    }

    // -------------------------------------------------------------------------
    // Key helpers
    // -------------------------------------------------------------------------

    private prefixKey(key: string): string {
        return `${this.prefix}${key}`;
    }

    private tagIndexKey(tag: string): string {
        return `${this.prefix}${TAG_INDEX_PREFIX}${tag}`;
    }

    // -------------------------------------------------------------------------
    // Core API
    // -------------------------------------------------------------------------

    /**
     * Retrieve a cached value by key.
     * Returns `undefined` when the key is absent or has expired.
     */
    async get<T = unknown>(key: string): Promise<T | undefined> {
        const raw = await this.adapter.get(this.prefixKey(key));
        if (raw === undefined || raw === null) return undefined;

        try {
            return parseSafely(raw as string) as T;
        } catch (error) {
            if (error instanceof PollutionError) throw error;
            throw new Error(
                `cache-kit: failed to deserialize value for key "${key}". ` + 'The stored value is not valid JSON.',
            );
        }
    }

    /**
     * Store a value under key, optionally with a TTL and/or tags.
     *
     * @param key     Cache key (namespace prefix is applied automatically).
     * @param value   Any JSON-serialisable value.
     * @param options `ttl` in seconds and/or `tags` for group invalidation.
     *                A bare number is treated as `ttl` seconds (shorthand).
     */
    async set<T>(key: string, value: T, options?: number | SetOptions): Promise<void> {
        const { ttl, tags } = this.resolveSetOptions(options);
        const serialized = JSON.stringify(value);
        const effectiveTtl = ttl ?? this.defaultTtl;
        if (effectiveTtl !== undefined && effectiveTtl !== 0 && !(effectiveTtl > 0 && Number.isFinite(effectiveTtl))) {
            throw new RangeError(
                `cache-kit: invalid TTL ${String(effectiveTtl)}: expected a positive number of seconds`,
            );
        }

        await this.adapter.set(this.prefixKey(key), serialized, effectiveTtl);

        if (tags && tags.length > 0) {
            await this.indexTags(key, tags);
        }
    }

    /**
     * Check whether a key exists in the cache (and has not expired).
     */
    async has(key: string): Promise<boolean> {
        return this.adapter.has(this.prefixKey(key));
    }

    /**
     * Delete a single key from the cache.
     */
    async delete(key: string): Promise<void> {
        await this.adapter.del(this.prefixKey(key));
    }

    /**
     * Flush the **entire** backing store shared by this Cache and every other
     * Cache built on the same adapter.
     *
     * Implementation note: the {@link KVAdapter} interface does not expose key
     * enumeration, so this recycles the adapter via `disconnect()`/`connect()`,
     * which is a whole-store reset rather than a namespace-scoped one. To avoid
     * a namespaced sub-cache silently nuking its siblings, this method refuses
     * to run when a namespace prefix is set: it is only valid on a root Cache.
     *
     * @throws Error when called on a namespaced Cache (a prefix is set).
     */
    async clear(): Promise<void> {
        if (this.prefix !== '') {
            const namespace = this.prefix.replace(/:$/, '');
            throw new Error(
                `cache-kit: clear() resets the entire shared backing store and ` +
                    `cannot be called on the namespaced cache "${namespace}". ` +
                    'Delete individual keys with delete(), invalidate a group with ' +
                    'invalidateTag(), or call clear() on the root cache to reset everything.',
            );
        }
        await this.adapter.disconnect();
        await this.adapter.connect();
    }

    // -------------------------------------------------------------------------
    // Cache-aside (remember / wrap)
    // -------------------------------------------------------------------------

    /**
     * Return the cached value for `key` if present; otherwise call `fallback`,
     * store the result with the given TTL, and return it.
     *
     * The fallback is called **exactly once** on a cache miss — never on a hit.
     * An error it throws is rethrown as is (so its class, status or code still
     * reach the caller's error handling) and nothing is cached.
     *
     * @param key      Cache key.
     * @param ttl      TTL in seconds for the stored value.
     * @param fallback Async factory invoked on a cache miss.
     */
    async remember<T>(key: string, ttl: number, fallback: () => Promise<T>): Promise<T> {
        const cached = await this.get<T>(key);
        if (cached !== undefined) return cached;

        const value = await fallback();
        await this.set(key, value, { ttl });
        return value;
    }

    /** Alias for {@link remember}. */
    readonly wrap = this.remember.bind(this);

    // -------------------------------------------------------------------------
    // Tag-based invalidation
    // -------------------------------------------------------------------------

    /**
     * Invalidate every cached entry that was stored with the given tag.
     *
     * After this call all keys associated with `tag` are deleted and the tag
     * index entry is removed. Entries carrying other tags are unaffected.
     */
    async invalidateTag(tag: string): Promise<void> {
        const indexKey = this.tagIndexKey(tag);
        await withLock(this.adapter, indexKey, () => this.invalidateIndex(indexKey));
    }

    private async invalidateIndex(indexKey: string): Promise<void> {
        const raw = await this.adapter.get(indexKey);
        if (raw === null || raw === undefined) return;

        let keys: string[];
        try {
            keys = JSON.parse(raw as string) as string[];
        } catch {
            keys = [];
        }

        await Promise.all([...keys.map((k) => this.adapter.del(this.prefixKey(k))), this.adapter.del(indexKey)]);
    }

    // -------------------------------------------------------------------------
    // Namespace helper
    // -------------------------------------------------------------------------

    /**
     * Return a new `Cache` sharing the same backing adapter but with an
     * additional namespace prefix, preventing key collisions between modules.
     *
     * @example
     * ```ts
     * const users = cache.namespace('users');
     * const posts = cache.namespace('posts');
     * // 'users:profile:1' and 'posts:profile:1' are distinct keys
     * ```
     */
    namespace(prefix: string): Cache {
        const parentNs = this.prefix.replace(/:$/, '');
        const combinedPrefix = parentNs ? `${parentNs}:${prefix}` : prefix;
        return new Cache(this.adapter, {
            namespace: combinedPrefix,
            defaultTtl: this.defaultTtl,
        });
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private resolveSetOptions(options?: number | SetOptions): SetOptions {
        if (options === undefined) return {};
        if (typeof options === 'number') return { ttl: options };
        return options;
    }

    /**
     * Read-modify-write of each tag's index, one at a time per index key: two
     * concurrent set() calls with the same tag used to both read the old index
     * and one key was lost, so invalidateTag() missed it. The lock is
     * per-process; instances sharing Redis can still race (see the docs).
     */
    private async indexTags(key: string, tags: string[]): Promise<void> {
        await Promise.all(
            tags.map((tag) => {
                const indexKey = this.tagIndexKey(tag);
                return withLock(this.adapter, indexKey, () => this.addToIndex(indexKey, key));
            }),
        );
    }

    private async addToIndex(indexKey: string, key: string): Promise<void> {
        const raw = await this.adapter.get(indexKey);
        let keys: string[] = [];
        if (raw !== null && raw !== undefined) {
            try {
                keys = JSON.parse(raw as string) as string[];
            } catch {
                keys = [];
            }
        }
        if (keys.includes(key)) return;
        await this.adapter.set(indexKey, JSON.stringify([...keys, key]));
    }
}
