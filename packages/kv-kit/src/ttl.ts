/**
 * A TTL in seconds: `undefined`, `null` or `0` mean "no expiry". Anything else
 * must be a positive finite number: a negative TTL used to delete the key at
 * once with the memory adapter and fail with Redis.
 */
export function checkTtl(ttl: number | null | undefined): number | undefined {
    if (ttl === undefined || ttl === null || ttl === 0) return undefined;
    if (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl < 0) {
        throw new RangeError(`Invalid TTL ${String(ttl)}: expected a positive number of seconds`);
    }
    return ttl;
}
