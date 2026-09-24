import { describe, expect, it } from "bun:test";
import { Kernel } from "../src/kernel";
import { RateLimitFeature } from "../src/features/rate-limit";
import { CacheFeature } from "../src/features/cache";

describe("Rate Limit Feature", () => {
    it("should allow requests within the limit", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new RateLimitFeature({
            windowMs: 5000,
            max: 5,
            keyGenerator: () => "test-user",
        }));
        await kernel.initialize();

        const app = kernel.getApp();
        app.get("/test", (c) => c.text("ok"));

        for (let i = 0; i < 5; i++) {
            const res = await app.request("/test");
            expect(res.status).toBe(200);
        }

        await kernel.shutdown();
    });

    it("should return 429 when limit is exceeded", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new RateLimitFeature({
            windowMs: 5000,
            max: 2,
            keyGenerator: () => "rate-test",
        }));
        await kernel.initialize();

        const app = kernel.getApp();
        app.get("/limited", (c) => c.text("ok"));

        expect((await app.request("/limited")).status).toBe(200);
        expect((await app.request("/limited")).status).toBe(200);
        expect((await app.request("/limited")).status).toBe(429);

        await kernel.shutdown();
    });

    it("should set standard rate limit headers", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new RateLimitFeature({
            windowMs: 10000,
            max: 10,
            keyGenerator: () => "headers-test",
            standardHeaders: true,
        }));
        await kernel.initialize();

        const app = kernel.getApp();
        app.get("/headers", (c) => c.text("ok"));

        const res = await app.request("/headers");
        expect(res.headers.get("X-RateLimit-Limit")).toBe("10");
        expect(res.headers.get("X-RateLimit-Remaining")).toBe("9");
        expect(res.headers.get("X-RateLimit-Reset")).toBeDefined();

        await kernel.shutdown();
    });

    it("should skip rate limiting when skip function returns true", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new RateLimitFeature({
            windowMs: 5000,
            max: 1,
            keyGenerator: () => "skip-test",
            skip: () => true,
        }));
        await kernel.initialize();

        const app = kernel.getApp();
        app.get("/skip", (c) => c.text("ok"));

        // All requests should pass even though max is 1
        expect((await app.request("/skip")).status).toBe(200);
        expect((await app.request("/skip")).status).toBe(200);
        expect((await app.request("/skip")).status).toBe(200);

        await kernel.shutdown();
    });

    it("should work with cache store", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new CacheFeature({ adapter: "memory" }));
        kernel.registerFeature(new RateLimitFeature({
            windowMs: 5000,
            max: 2,
            store: "cache",
            keyGenerator: () => "cache-rl-test",
        }));
        await kernel.initialize();

        const app = kernel.getApp();
        app.get("/cache-rl", (c) => c.text("ok"));

        expect((await app.request("/cache-rl")).status).toBe(200);
        expect((await app.request("/cache-rl")).status).toBe(200);
        expect((await app.request("/cache-rl")).status).toBe(429);

        await kernel.shutdown();
    });

    it("should decrement remaining count with each request", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new RateLimitFeature({
            windowMs: 10000,
            max: 3,
            keyGenerator: () => "decrement-test",
        }));
        await kernel.initialize();

        const app = kernel.getApp();
        app.get("/dec", (c) => c.text("ok"));

        const res1 = await app.request("/dec");
        expect(res1.headers.get("X-RateLimit-Remaining")).toBe("2");

        const res2 = await app.request("/dec");
        expect(res2.headers.get("X-RateLimit-Remaining")).toBe("1");

        const res3 = await app.request("/dec");
        expect(res3.headers.get("X-RateLimit-Remaining")).toBe("0");

        await kernel.shutdown();
    });

    describe("default client key", () => {
        const socket = (address: string) => ({ requestIP: () => ({ address, family: "IPv4", port: 40000 }) });

        it("ignores a spoofed X-Forwarded-For unless trustProxy is set", async () => {
            // Regression: the key used to be the raw X-Forwarded-For header, so a
            // client rotating it was never limited.
            const kernel = new Kernel();
            kernel.registerFeature(new RateLimitFeature({ windowMs: 5000, max: 2 }));
            await kernel.initialize();
            const app = kernel.getApp();
            app.get("/x", (c) => c.text("ok"));

            const env = socket("203.0.113.9");
            const statuses = [];
            for (const ip of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) {
                statuses.push((await app.request("/x", { headers: { "x-forwarded-for": ip } }, env)).status);
            }
            expect(statuses).toEqual([200, 200, 429]);

            await kernel.shutdown();
        });

        it("gives distinct forwarded clients their own bucket behind a trusted proxy", async () => {
            const kernel = new Kernel({ trustProxy: true });
            kernel.registerFeature(new RateLimitFeature({ windowMs: 5000, max: 1 }));
            await kernel.initialize();
            const app = kernel.getApp();
            app.get("/x", (c) => c.text("ok"));

            const proxy = socket("10.0.0.2");
            const req = (ip: string) => app.request("/x", { headers: { "x-forwarded-for": ip } }, proxy);
            expect((await req("198.51.100.1")).status).toBe(200);
            expect((await req("198.51.100.2")).status).toBe(200);
            expect((await req("198.51.100.1")).status).toBe(429);

            await kernel.shutdown();
        });
    });
});
