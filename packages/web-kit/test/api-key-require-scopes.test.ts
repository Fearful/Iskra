import { describe, it, expect } from "bun:test";
import { Kernel } from "../src/kernel";
import { ApiKeyFeature } from "../src/features/api-key";

// RED test for the MEDIUM "requireScopes dead" finding
// (src/features/api-key.ts:159). `requireScopes` is set in config but never
// read. The chosen fix is to ENFORCE it in the app.use("*") handler: when
// requireScopes is true, a validated key that carries no scope must be rejected
// (403). A key with at least one scope passes.

describe("ApiKeyFeature — requireScopes enforcement", () => {
    it("rejects a scopeless key when requireScopes is true", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(
            new ApiKeyFeature({
                requireScopes: true,
                staticKeys: [{ key: "no-scope-key", name: "k", scopes: [] }],
            }),
        );
        await kernel.initialize();

        const app = kernel.getApp();
        app.get("/api", (c) => c.text("secret"));

        const res = await app.request("/api", { headers: { "X-API-Key": "no-scope-key" } });
        expect(res.status).toBe(403);

        await kernel.shutdown();
    });

    it("allows a scoped key when requireScopes is true", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(
            new ApiKeyFeature({
                requireScopes: true,
                staticKeys: [{ key: "scoped-key", name: "k", scopes: ["read"] }],
            }),
        );
        await kernel.initialize();

        const app = kernel.getApp();
        app.get("/api", (c) => c.text("secret"));

        const res = await app.request("/api", { headers: { "X-API-Key": "scoped-key" } });
        expect(res.status).toBe(200);

        await kernel.shutdown();
    });

    it("does not require scopes when requireScopes is false (default)", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(
            new ApiKeyFeature({
                staticKeys: [{ key: "no-scope-key", name: "k", scopes: [] }],
            }),
        );
        await kernel.initialize();

        const app = kernel.getApp();
        app.get("/api", (c) => c.text("secret"));

        const res = await app.request("/api", { headers: { "X-API-Key": "no-scope-key" } });
        expect(res.status).toBe(200);

        await kernel.shutdown();
    });
});
