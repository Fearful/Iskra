import type { KVAdapter } from '@iskra-bun/kv-kit';

export type { KVAdapter };

export interface CacheOptions {
    /** Prefix prepended to every key — prevents collisions between modules. */
    namespace?: string;
    /** Default TTL in seconds applied when set() is called without an explicit ttl. */
    defaultTtl?: number;
}

export interface SetOptions {
    /** TTL in seconds. Overrides any defaultTtl configured on the Cache. */
    ttl?: number;
    /**
     * Tag names associated with this entry.
     *
     * Pass one or more tags so the entry can later be invalidated as a group
     * via `Cache.invalidateTag(tag)`.
     */
    tags?: string[];
}
