import { describe, it, expect } from "bun:test";
import { Kernel } from "../src/kernel";
import { ApiKeyFeature, requireApiKey } from "../src/features/api-key";
import { CacheFeature } from "../src/features/cache";

const JWT = "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig";

async function setup(config: ConstructorParameters<typeof ApiKeyFeature>[0], withCache = false) {
    const kernel = new Kernel();
    if (withCache) kernel.registerFeature(new CacheFeature({ adapter: "memory" }));
    kernel.registerFeature(new ApiKeyFeature(config));
    await kernel.initialize();
    const app = kernel.getApp();
    app.get("/public", (c) => c.text("public"));
    app.get("/private", requireApiKey(), (c) => c.text(c.get("apiKey")!.name ?? ""));
    return { kernel, app };
}

describe("ApiKeyFeature and Bearer tokens from other auth schemes", () => {
    it("does not reject a non-API-key Bearer token on public routes", async () => {
        // Regression: the default ["header","bearer"] strategies returned 401 for
        // any Bearer token that wasn't an API key, breaking JWT/session auth app-wide.
        const { kernel, app } = await setup({ staticKeys: [{ key: "k1", name: "svc" }] });
        expect((await app.request("/public", { headers: { Authorization: JWT } })).status).toBe(200);

        const res = await app.request("/private", { headers: { Authorization: JWT } });
        expect(res.status).toBe(401);
        expect(await res.text()).toContain("Invalid API key");
        await kernel.shutdown();
    });

    it("still accepts a valid key sent as a Bearer token", async () => {
        const { kernel, app } = await setup({ staticKeys: [{ key: "k1", name: "svc" }] });
        const res = await app.request("/private", { headers: { Authorization: "Bearer k1" } });
        expect(await res.text()).toBe("svc");
        await kernel.shutdown();
    });

    it("still rejects an invalid key sent in the API-key header", async () => {
        const { kernel, app } = await setup({ staticKeys: [{ key: "k1", name: "svc" }] });
        expect((await app.request("/public", { headers: { "X-API-Key": "nope" } })).status).toBe(401);
        await kernel.shutdown();
    });
});

describe("ApiKeyFeature cache", () => {
    it("re-checks expiry on a cache hit", async () => {
        const expiresAt = new Date(Date.now() + 60);
        const { kernel, app } = await setup({ staticKeys: [{ key: "k1", name: "svc", expiresAt }] }, true);
        const headers = { "X-API-Key": "k1" };
        expect((await app.request("/private", { headers })).status).toBe(200); // cached now

        await new Promise((r) => setTimeout(r, 90));
        const res = await app.request("/private", { headers });
        expect(res.status).toBe(401);
        expect(await res.text()).toContain("expired");
        await kernel.shutdown();
    });

    it("ignores a cached entry for a key that is no longer configured", async () => {
        // A shared cache (e.g. Redis) outlives the restart that removed the key.
        const entries = new Map<string, unknown>();
        const sharedCache = {
            name: "cache",
            client: {
                get: async (k: string) => entries.get(k) ?? null,
                set: async (k: string, v: unknown) => void entries.set(k, v),
                delete: async (k: string) => void entries.delete(k),
                exists: async (k: string) => entries.has(k),
            },
            async initialize() {},
        };
        const boot = async (key: string) => {
            const kernel = new Kernel();
            kernel.registerFeature(sharedCache as any);
            kernel.registerFeature(new ApiKeyFeature({ staticKeys: [{ key, name: key }] }));
            await kernel.initialize();
            kernel.getApp().get("/private", requireApiKey(), (c) => c.text("ok"));
            return kernel.getApp();
        };

        const before = await boot("rotated");
        expect((await before.request("/private", { headers: { "X-API-Key": "rotated" } })).status).toBe(200);
        expect(entries.size).toBe(1);

        const after = await boot("current");
        expect((await after.request("/private", { headers: { "X-API-Key": "rotated" } })).status).toBe(401);
    });
});

describe("ApiKeyFeature callbacks", () => {
    it("calls onValidated, onError and the custom extractor", async () => {
        const validated: string[] = [];
        const { kernel, app } = await setup({
            staticKeys: [{ key: "k1", name: "svc" }],
            extractStrategies: ["custom"],
            customExtractor: (c) => c.req.header("X-Custom-Key") ?? null,
            onValidated: (key) => {
                validated.push(key.name!);
            },
            onError: (error, c) => c.json({ custom: error }, 418),
        });

        expect(await (await app.request("/private", { headers: { "X-Custom-Key": "k1" } })).text()).toBe("svc");
        expect(validated).toEqual(["svc"]);

        const bad = await app.request("/public", { headers: { "X-Custom-Key": "nope" } });
        expect(bad.status).toBe(418);
        expect(await bad.json()).toEqual({ custom: "Invalid API key" });
        await kernel.shutdown();
    });
});
