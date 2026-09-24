import { describe, it, expect } from "bun:test";
import { Kernel } from "../src/kernel";
import { ApiKeyStore, ApiKeyFeature, requireApiKey } from "../src/features/api-key";

describe("ApiKeyStore id derivation (no secret leakage)", () => {
    const KEY = "super-secret-api-key-1234567890";

    it("does not derive the id from a prefix/substring of the key", async () => {
        const store = new ApiKeyStore(
            { staticKeys: [{ key: KEY, name: "k", scopes: ["read"] }], enableCache: false } as any,
            {} as any,
        );

        const result = await store.validate(KEY);
        expect(result.isValid).toBe(true);

        const id = result.key!.id;
        // The id must not be a prefix of the key, nor appear anywhere in it.
        expect(KEY.startsWith(id)).toBe(false);
        expect(KEY.includes(id)).toBe(false);
        // And the key must not start with the id (no usable prefix leak).
        expect(id).not.toBe(KEY.substring(0, 8));
    });

    it("still authenticates end-to-end after id derivation change", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(
            new ApiKeyFeature({
                staticKeys: [{ key: KEY, name: "k", scopes: ["read"] }],
                enableCache: false,
            }),
        );
        await kernel.initialize();

        const app = kernel.getApp();
        app.get("/secret", requireApiKey(), (c) => c.text("ok"));

        expect((await app.request("/secret", { headers: { "X-API-Key": KEY } })).status).toBe(200);
        expect((await app.request("/secret", { headers: { "X-API-Key": "wrong" } })).status).toBe(401);
        expect((await app.request("/secret")).status).toBe(401);

        await kernel.shutdown();
    });
});
