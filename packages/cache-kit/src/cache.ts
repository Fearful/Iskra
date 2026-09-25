import { MemoryAdapter } from './memory-adapter';
import type { KVAdapter, CacheOptions, SetOptions } from './types';

/** A tag's index as an expiring set, with adapters that have `sadd`/`sdrain`. */
const TAG_SET_PREFIX = '__cache_tags__:';

/** A tag's index as a JSON list: with other adapters, and every index written before 0.x. */
const TAG_LIST_PREFIX = '__cache_tag__:';

/**
 * Data keys and namespaces may not reach the tag indexes: a key such as
 * `__cache_tag__:perms` overwrote the index, and invalidateTag('perms') then
 * deleted whatever keys it listed.
 */
const RESERVED = /(?:^|:)__cache_tags?__:/;

/** Longest JSON tag index: beyond it, the oldest entries are deleted along with their data. */
const MAX_TAG_LIST = 10_000;

/** Keys deleted per call when a tag is invalidated. */
const DELETE_BATCH = 1000;

/** Keys that enable prototype-pollution when an object is later deep-merged. */
const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'] as const;

/** One of them as a key in JSON.stringify's output, which escapes none of their characters. */
const DANGEROUS_KEY_TEXT = /"(?:__proto__|constructor|prototype)":/;

class PollutionError extends Error {}

/** A JSON tag index entry: the key and its expiry (ms since the epoch, 0 for none). */
type TagEntry = [key: string, expiresAt: number];

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

/** Whether get() would refuse this serialized value (see parseSafely). */
function isPolluted(serialized: string | undefined): boolean {
    if (serialized === undefined || !DANGEROUS_KEY_TEXT.test(serialized)) return false;
    try {
        parseSafely(serialized);
        return false;
    } catch (error) {
        return error instanceof PollutionError;
    }
}

/** A JSON tag index; before 0.x its entries were bare keys, with no expiry. */
function parseTagList(raw: unknown): TagEntry[] {
    if (typeof raw !== 'string') return [];
    let list: unknown;
    try {
        list = JSON.parse(raw);
    } catch {
        return [];
    }
    if (!Array.isArray(list)) return [];
    return list.flatMap((entry): TagEntry[] => {
        if (typeof entry === 'string') return [[entry, 0]];
        if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number') {
            return [[entry[0], entry[1]]];
        }
        return [];
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
        if (RESERVED.test(this.prefix)) {
            throw new Error(`cache-kit: the namespace "${options.namespace}" is reserved for tag indexes`);
        }
    }

    // -------------------------------------------------------------------------
    // Key helpers
    // -------------------------------------------------------------------------

    private prefixKey(key: string): string {
        const full = `${this.prefix}${key}`;
        if (RESERVED.test(full)) throw new Error(`cache-kit: the key "${key}" is reserved for tag indexes`);
        return full;
    }

    private tagSetKey(tag: string): string {
        return `${this.prefix}${TAG_SET_PREFIX}${tag}`;
    }

    private tagListKey(tag: string): string {
        return `${this.prefix}${TAG_LIST_PREFIX}${tag}`;
    }

    // -------------------------------------------------------------------------
    // Core API
    // -------------------------------------------------------------------------

    /**
     * Retrieve a cached value by key.
     * Returns `undefined` when the key is absent or has expired, or when the
     * stored value carries a prototype-pollution key (the entry is deleted).
     */
    async get<T = unknown>(key: string): Promise<T | undefined> {
        const dataKey = this.prefixKey(key);
        const raw = await this.adapter.get(dataKey);
        if (raw === undefined || raw === null) return undefined;

        try {
            return parseSafely(raw as string) as T;
        } catch (error) {
            if (error instanceof PollutionError) {
                // A miss: thrown, it failed every read until the TTL ran out
                // (never without one), and remember() did not refetch.
                await this.adapter.del(dataKey);
                return undefined;
            }
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
        const dataKey = this.prefixKey(key);
        const serialized = JSON.stringify(value);
        const effectiveTtl = ttl ?? this.defaultTtl;
        if (effectiveTtl !== undefined && effectiveTtl !== 0 && !(effectiveTtl > 0 && Number.isFinite(effectiveTtl))) {
            throw new RangeError(
                `cache-kit: invalid TTL ${String(effectiveTtl)}: expected a positive number of seconds`,
            );
        }

        // get() could never return it: nothing is stored (and the old value goes).
        if (isPolluted(serialized)) {
            await this.adapter.del(dataKey);
            return;
        }

        await this.adapter.set(dataKey, serialized, effectiveTtl);

        if (tags && tags.length > 0) {
            await this.indexTags(key, tags, effectiveTtl);
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
     * Delete every entry of this cache: its namespace (with the namespaces and
     * tag indexes under it), or all the adapter's keys for a root cache. It
     * runs the adapter's `clear()`: a KVManager clears its own namespace, and
     * on Redis never the whole database unless `flushDb` allows it.
     *
     * It used to recycle the adapter (disconnect + connect): on Redis that
     * deleted nothing, and a reconnect failing during a blip left the shared
     * adapter dead after Redis recovered.
     *
     * @throws Error when the adapter has no `clear()`.
     */
    async clear(): Promise<void> {
        if (!this.adapter.clear) {
            throw new Error(`cache-kit: the "${this.adapter.id}" adapter cannot clear its keys (it has no clear())`);
        }
        await this.adapter.clear(this.prefix);
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
        const listKey = this.tagListKey(tag);
        await withLock(this.adapter, listKey, async () => {
            // The JSON list too with an adapter that has sets: entries tagged
            // before 0.x are listed there.
            const keys = await this.drainList(listKey);
            if (this.adapter.sdrain) keys.push(...(await this.adapter.sdrain(this.tagSetKey(tag))));
            await this.deleteKeys(keys);
        });
    }

    private async drainList(listKey: string): Promise<string[]> {
        const raw = await this.adapter.get(listKey);
        if (raw === null || raw === undefined) return [];
        await this.adapter.del(listKey);
        return parseTagList(raw).map(([key]) => key);
    }

    /** Deletes the entries of `keys` (relative to this cache), in batches; never a tag index. */
    private async deleteKeys(keys: string[]): Promise<void> {
        const full = [...new Set(keys)].map((key) => `${this.prefix}${key}`).filter((key) => !RESERVED.test(key));
        for (let i = 0; i < full.length; i += DELETE_BATCH) {
            const batch = full.slice(i, i + DELETE_BATCH);
            if (this.adapter.mdel) await this.adapter.mdel(batch);
            else await Promise.all(batch.map((key) => this.adapter.del(key)));
        }
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
     * Adds `key` to each tag's index, for as long as the entry lives. With an
     * adapter that has `sadd` it is one atomic step per tag, whatever the size
     * of the index. Otherwise a JSON list is rewritten, one set() at a time per
     * index key (concurrent set() calls used to both read the old index and
     * one key was lost); that lock is per-process, so instances sharing a store
     * can still race (see the docs).
     */
    private async indexTags(key: string, tags: string[], ttl: number | undefined): Promise<void> {
        const adapter = this.adapter;
        await Promise.all(
            tags.map((tag) => {
                if (adapter.sadd && adapter.sdrain) return adapter.sadd(this.tagSetKey(tag), key, ttl || undefined);
                const listKey = this.tagListKey(tag);
                return withLock(adapter, listKey, () => this.addToList(listKey, key, ttl));
            }),
        );
    }

    /**
     * Rewriting the whole list on every set() made each one slower than the
     * last, and expired keys were never dropped: they are now, the list expires
     * with its last entry, and past MAX_TAG_LIST the oldest entries are deleted
     * with their data (a deleted entry needs no invalidating).
     */
    private async addToList(listKey: string, key: string, ttl: number | undefined): Promise<void> {
        const now = Date.now();
        const expiresAt = ttl ? now + ttl * 1000 : 0;
        const entries = parseTagList(await this.adapter.get(listKey)).filter(([, at]) => at === 0 || at > now);
        const existing = entries.find(([listed]) => listed === key);
        if (!existing) entries.push([key, expiresAt]);
        // A key keeps its longest expiry: an earlier write may still be alive.
        else if (existing[1] !== 0) existing[1] = expiresAt === 0 ? 0 : Math.max(existing[1], expiresAt);

        const evicted = entries.length > MAX_TAG_LIST ? entries.splice(0, entries.length - MAX_TAG_LIST) : [];
        await this.deleteKeys(evicted.map(([listed]) => listed));

        // The list lives as long as its longest-lived entry (for good if one has no TTL).
        const forever = entries.some(([, at]) => at === 0);
        const last = entries.reduce((max, [, at]) => Math.max(max, at), 0);
        const listTtl = forever ? undefined : (last - now) / 1000;
        await this.adapter.set(listKey, JSON.stringify(entries), listTtl);
    }
}
