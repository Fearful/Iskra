
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { createHash } from "crypto";
import { ApiKeyStore } from "../src/features/api-key";
import type { Kernel } from "../src/kernel";

describe("ApiKeyStore Cache Integration", () => {
    let mockCache: any;
    let mockKernel: any;
    let store: ApiKeyStore;

    const staticKey = {
        id: "key-123",
        key: "abcdef123456",
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
            getFeature: mock((name: string) => {
                if (name === 'cache') {
                    return { client: mockCache };
                }
                return undefined;
            })
        };

        store = new ApiKeyStore({
            staticKeys: [staticKey],
            enableCache: true
        } as any, mockKernel as unknown as Kernel);
    });

    it("should consult cache on validate", async () => {
        // First call: Cache miss, should fallback to static keys and set cache
        const result = await store.validate(staticKey.key);

        const hashedKey = `apikey:${createHash("sha256").update(staticKey.key).digest("hex")}`;

        expect(result.isValid).toBe(true);
        expect(mockCache.get).toHaveBeenCalledWith(hashedKey);
        expect(mockCache.set).toHaveBeenCalled();
        const setArgs = mockCache.set.mock.calls[0];
        expect(setArgs[0]).toBe(hashedKey);

        // Parse the stored value to verify it contains key data
        const storedValue = JSON.parse(setArgs[1]);
        expect(storedValue.key).toBe(staticKey.key);
    });

    it("should return cached value if present", async () => {
        // Preset cache
        const createdAt = new Date().toISOString();
        const cachedMetadata = {
            id: "key-cached",
            key: staticKey.key,
            name: "Cached Key",
            scopes: ["read"],
            createdAt,
        };
        mockCache.get = mock(() => Promise.resolve(JSON.stringify(cachedMetadata)));

        const result = await store.validate(staticKey.key);

        expect(result.isValid).toBe(true);
        expect(mockCache.get).toHaveBeenCalled();
        // Cache returns JSON-parsed metadata — Date fields become strings after serialization
        expect(result.key).toBeDefined();
        expect(result.key!.id).toBe("key-cached");
        expect(result.key!.name).toBe("Cached Key");
        expect(result.key!.key).toBe(staticKey.key);
    });

    it("should not use cache if disabled in config", async () => {
        store = new ApiKeyStore({
            staticKeys: [staticKey],
            enableCache: false
        } as any, mockKernel as unknown as Kernel);

        const result = await store.validate(staticKey.key);
        expect(result.isValid).toBe(true);
        expect(mockKernel.getFeature).not.toHaveBeenCalled();
    });
});
