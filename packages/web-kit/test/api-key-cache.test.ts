import { describe, it, expect, mock } from "bun:test";
import { ApiKeyStore } from "../src/features/api-key";
import type { Kernel } from "../src/kernel";

// Keys used to be cached through the cache feature: the entry held the
// plaintext key, and on a hit its scopes and expiry were used instead of the
// current config, so a revoked key kept working for cacheTtl.
describe("ApiKeyStore without a cache", () => {
    const staticKey = { key: "sk_live_SUPERSECRET_1234567890", name: "Test Key", scopes: ["read"] };

    function kernelWithCache() {
        const cache = { get: mock(() => Promise.resolve(JSON.stringify({ ...staticKey, scopes: ["admin"] }))), set: mock(() => Promise.resolve()) };
        const kernel = { getFeature: mock((name: string) => (name === "cache" ? { client: cache } : undefined)) };
        return { cache, kernel: kernel as unknown as Kernel };
    }

    it("never reads or writes the cache, even with enableCache", async () => {
        const { cache, kernel } = kernelWithCache();
        const store = new ApiKeyStore({ staticKeys: [staticKey], enableCache: true } as any, kernel);

        const result = await store.validate(staticKey.key);

        expect(result.isValid).toBe(true);
        // The current config's scopes, not a cached entry's.
        expect(result.key!.scopes).toEqual(["read"]);
        expect(cache.get).not.toHaveBeenCalled();
        expect(cache.set).not.toHaveBeenCalled();
    });

    it("rejects a key once it is removed or expired in the config", async () => {
        const { kernel } = kernelWithCache();
        const before = new ApiKeyStore({ staticKeys: [staticKey], enableCache: true } as any, kernel);
        expect((await before.validate(staticKey.key)).isValid).toBe(true);

        // A restart with the key expired, and one with it removed.
        const expired = new ApiKeyStore(
            { staticKeys: [{ ...staticKey, expiresAt: new Date(Date.now() - 1000) }], enableCache: true } as any,
            kernel,
        );
        const removed = new ApiKeyStore({ staticKeys: [], enableCache: true } as any, kernel);
        expect(await expired.validate(staticKey.key)).toEqual({ isValid: false, error: "API key has expired" });
        expect(await removed.validate(staticKey.key)).toEqual({ isValid: false, error: "Invalid API key" });
    });
});
