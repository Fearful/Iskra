/** Most keys a {@link HitCounter} keeps unless told otherwise. */
export const DEFAULT_MAX_KEYS = 100_000;

/** How often expired keys are swept, in ms. */
const SWEEP_INTERVAL_MS = 60_000;

/**
 * Request counts per client key over fixed windows, kept in memory (the
 * rate limiters' memory store). Bounded: clients rotating their key used to
 * grow it for as long as the window lasted. Past `maxKeys` the oldest keys are
 * dropped (those clients start a new window), and expired keys are swept every
 * minute by a timer that does not keep the process alive.
 */
export class HitCounter {
    private hits = new Map<string, { count: number; resetAt: number }>();
    private sweeper: ReturnType<typeof setInterval>;
    private readonly maxKeys: number;

    constructor(maxKeys: number = DEFAULT_MAX_KEYS) {
        this.maxKeys = Math.max(1, Math.floor(maxKeys) || DEFAULT_MAX_KEYS);
        this.sweeper = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
        this.sweeper.unref?.();
    }

    /** Counts a hit for `key` and returns the count in its current window. */
    hit(key: string, windowMs: number): number {
        const now = Date.now();
        const entry = this.hits.get(key);
        if (entry && now < entry.resetAt) return ++entry.count;

        // Deleted and re-added, not updated in place: the Map keeps insertion
        // order, so its first keys are always the oldest windows.
        this.hits.delete(key);
        this.hits.set(key, { count: 1, resetAt: now + windowMs });
        for (const oldest of this.hits.keys()) {
            if (this.hits.size <= this.maxKeys) break;
            this.hits.delete(oldest);
        }
        return 1;
    }

    /** How many keys are tracked. */
    get size(): number {
        return this.hits.size;
    }

    private sweep(): void {
        const now = Date.now();
        for (const [key, entry] of this.hits) {
            if (now >= entry.resetAt) this.hits.delete(key);
        }
    }

    /** Stops the sweep timer. */
    dispose(): void {
        clearInterval(this.sweeper);
    }
}
