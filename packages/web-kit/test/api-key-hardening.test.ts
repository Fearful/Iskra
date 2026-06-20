import { describe, it, expect, mock, beforeEach } from "bun:test";
import { createHash } from "crypto";
import { ApiKeyStore } from "../src/features/api-key";
import type { Kernel } from "../src/kernel";
import type { ApiKeyMetadata } from "../src/types";

// RED tests for two MEDIUM api-key findings:
//   1. Plaintext cache key (src/features/api-key.ts:74,99): cacheKey =
//      `apikey:${key}` stores the raw API key as the cache key. The fix must
//      hash the key with SHA-256 before using it as the cache key.
//   2. Metadata mutation (src/features/api-key.ts:94): metadata.lastUsedAt =
//      new Date() mutates the object held in staticKeysMap. The fix must build
//      a derived object { ...metadata, lastUsedAt } and leave the stored one
//      untouched.

describe("ApiKeyStore — cache key hashing", () => {
    let mockCache: any;
    let mockKernel: any;
    let store: ApiKeyStore;

    const staticKey = {
        id: "key-123",
        key: "super-secret-api-key-value",
        name: "Test Key",
        scopes: ["read"],
        createdAt: new Date(),
    };

    beforeEach(() => {
        mockCache = {
            get: mock(() => Promise.resolve(null)),
            set: mock(() => Promise.resolve()),
        };
        mockKernel = {
            getFeature: mock((name: string) =>
                name === "cache" ? { client: mockCache } : undefined,
            ),
        };
        store = new ApiKeyStore(
            { staticKeys: [staticKey], enableCache: true } as any,
            mockKernel as unknown as Kernel,
        );
    });

    it("never uses the raw plaintext key as a cache key", async () => {
        await store.validate(staticKey.key);

        const getKey = mockCache.get.mock.calls[0][0];
        const setKey = mockCache.set.mock.calls[0][0];

        // The raw key must not appear anywhere in the cache key.
        expect(getKey).not.toContain(staticKey.key);
        expect(setKey).not.toContain(staticKey.key);
        expect(getKey).not.toBe(`apikey:${staticKey.key}`);
    });

    it("uses a SHA-256 hash of the key as the cache key", async () => {
        await store.validate(staticKey.key);

        const expectedHash = createHash("sha256").update(staticKey.key).digest("hex");
        const getKey: string = mockCache.get.mock.calls[0][0];
        const setKey: string = mockCache.set.mock.calls[0][0];

        // get and set must agree, and the key material must be the SHA-256 hash.
        expect(getKey).toBe(setKey);
        expect(getKey).toContain(expectedHash);
    });
});

describe("ApiKeyStore — metadata immutability", () => {
    it("does not mutate the stored metadata object on validate", async () => {
        const mockKernel: any = { getFeature: mock(() => undefined) };
        const staticKey = {
            id: "key-imm",
            key: "another-secret-key",
            name: "Immutable Key",
            scopes: ["read"],
            createdAt: new Date(),
        };
        const store = new ApiKeyStore(
            { staticKeys: [staticKey], enableCache: false } as any,
            mockKernel as unknown as Kernel,
        );

        const result = await store.validate(staticKey.key);
        expect(result.isValid).toBe(true);

        // Validate again and capture the second result. If validation mutates the
        // shared stored object, the first result's lastUsedAt would be advanced by
        // the second call. With a derived object, the stored metadata stays at the
        // initial `undefined` lastUsedAt and is never mutated in place.
        const firstSnapshot = JSON.stringify(result.key);
        await store.validate(staticKey.key);

        // The stored metadata held in staticKeysMap must be unchanged — it should
        // still have lastUsedAt === undefined (it was never mutated).
        const stored = (store as any).staticKeysMap.get(staticKey.key) as ApiKeyMetadata;
        expect(stored.lastUsedAt).toBeUndefined();

        // And the first returned object must not have been mutated by the second
        // validate call.
        expect(JSON.stringify(result.key)).toBe(firstSnapshot);
    });
});
