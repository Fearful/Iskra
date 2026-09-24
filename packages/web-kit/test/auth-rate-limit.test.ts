import { describe, it, expect, afterEach } from "bun:test";

// Test for the MEDIUM "rate-limit auth routes" finding
// (src/features/auth/index.ts). The auth feature must apply per-IP rate limiting
// to its routes by default so credential-stuffing / brute-force against sign-in
// and sign-up is throttled. The middleware is installed on `${basePath}/*`; the
// 21st request from the same IP within the window must be rejected with 429,
// while non-auth routes stay unthrottled.

import { AuthFeature } from "../src/features/auth/index";
import { Kernel } from "../src/kernel";

// Inject a fake createBetterAuth through AuthFeature's constructor seam rather
// than globally mocking @iskra-bun/auth-kit. bun's `mock.module` is process-wide
// and cannot be reverted, so a global mock here would leak into auth-kit's own
// security/integration suites and silently disable the real validation under
// test there.
const fakeCreateAuth = (() => ({
    handler: async () => new Response("ok"),
    api: { getSession: async () => null },
})) as any;

class FakeDbFeature {
    name = "db";
    db = {} as any;
    adapter = "sqlite" as const;
    async initialize() {}
}

const VALID_SECRET = "x".repeat(40);

describe("AuthFeature — per-IP auth-route rate limiting", () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        process.env.NODE_ENV = originalEnv;
    });

    it("throttles repeated requests to auth routes from the same IP (429)", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new FakeDbFeature() as any);
        const auth = new AuthFeature({ secret: VALID_SECRET, basePath: "/api/sso" } as any, fakeCreateAuth);
        kernel.registerFeature(auth);
        await kernel.initialize();

        const app = kernel.getApp();
        // A route under the auth basePath so the rate-limit middleware applies.
        app.get("/api/sso/ping", (c) => c.text("ok"));

        const headers = { "x-forwarded-for": "10.0.0.1" };

        // The default budget is 20 requests per IP per window.
        let last = 200;
        for (let i = 0; i < 25; i++) {
            last = (await app.request("/api/sso/ping", { headers })).status;
        }

        // Once the budget is exhausted the IP must be throttled.
        expect(last).toBe(429);
    });

    it("does not throttle a different IP", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new FakeDbFeature() as any);
        const auth = new AuthFeature({ secret: VALID_SECRET, basePath: "/api/sso" } as any, fakeCreateAuth);
        kernel.registerFeature(auth);
        await kernel.initialize();

        const app = kernel.getApp();
        app.get("/api/sso/ping", (c) => c.text("ok"));

        // Exhaust the budget for one IP.
        for (let i = 0; i < 25; i++) {
            await app.request("/api/sso/ping", { headers: { "x-forwarded-for": "10.0.0.1" } });
        }

        // A fresh IP starts with a full budget and is not throttled.
        const res = await app.request("/api/sso/ping", { headers: { "x-forwarded-for": "10.0.0.2" } });
        expect(res.status).toBe(200);
    });

    it("leaves non-auth routes unthrottled", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new FakeDbFeature() as any);
        const auth = new AuthFeature({ secret: VALID_SECRET, basePath: "/api/sso" } as any, fakeCreateAuth);
        kernel.registerFeature(auth);
        await kernel.initialize();

        const app = kernel.getApp();
        app.get("/public", (c) => c.text("ok"));

        const headers = { "x-forwarded-for": "10.0.0.3" };
        let last = 200;
        for (let i = 0; i < 30; i++) {
            last = (await app.request("/public", { headers })).status;
        }
        expect(last).toBe(200);
    });
});
