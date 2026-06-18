import { describe, it, expect } from "bun:test";
import { Kernel } from "../src/kernel";
import { HealthCheckFeature } from "../src/features/health";

// Minimal stand-in for a "db" feature: registers a context value with a query()
// method so the health check's per-feature probe has something to call.
class FakeDbFeature {
    name = "db";
    async initialize(kernel: Kernel) {
        kernel.getApp().use("*", async (c: any, next: any) => {
            c.set("db", { query: async () => [{ ok: 1 }] });
            await next();
        });
    }
}

describe("Health Check Feature", () => {
    it("reports ok with details and the registered feature list by default", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new HealthCheckFeature());
        await kernel.initialize();

        const res = await kernel.getApp().request("/health");
        expect(res.status).toBe(200);
        const json = (await res.json()) as any;
        expect(json.status).toBe("ok");
        expect(typeof json.timestamp).toBe("string");
        expect(Array.isArray(json.features)).toBe(true);
        expect(json.features).toContain("health");

        await kernel.shutdown();
    });

    it("omits details when includeDetails is false", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new HealthCheckFeature({ includeDetails: false }));
        await kernel.initialize();

        const json = (await (await kernel.getApp().request("/health")).json()) as any;
        expect(json.status).toBe("ok");
        expect(json.features).toBeUndefined();

        await kernel.shutdown();
    });

    it("probes a registered db feature and reports it healthy", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new FakeDbFeature() as any);
        kernel.registerFeature(new HealthCheckFeature());
        await kernel.initialize();

        const json = (await (await kernel.getApp().request("/health")).json()) as any;
        expect(json.features).toContain("db");
        expect(json.checks.db).toEqual({ status: "ok" });

        await kernel.shutdown();
    });

    it("runs custom checks and captures both results and errors", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(
            new HealthCheckFeature({
                checks: {
                    ok: async () => ({ status: "ok" }),
                    boom: async () => {
                        throw new Error("nope");
                    },
                },
            }),
        );
        await kernel.initialize();

        const json = (await (await kernel.getApp().request("/health")).json()) as any;
        expect(json.customChecks.ok).toEqual({ status: "ok" });
        expect(json.customChecks.boom.status).toBe("error");
        expect(json.customChecks.boom.error).toContain("nope");

        await kernel.shutdown();
    });

    it("responds to readiness and liveness probes", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new HealthCheckFeature());
        await kernel.initialize();
        const app = kernel.getApp();

        const ready = (await (await app.request("/health/ready")).json()) as any;
        expect(ready.status).toBe("ready");

        const live = (await (await app.request("/health/live")).json()) as any;
        expect(live.status).toBe("alive");
        expect(typeof live.uptime).toBe("number");

        await kernel.shutdown();
    });

    it("honors custom probe paths", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(
            new HealthCheckFeature({
                path: "/healthz",
                readinessPath: "/readyz",
                livenessPath: "/livez",
            }),
        );
        await kernel.initialize();
        const app = kernel.getApp();

        expect((await app.request("/healthz")).status).toBe(200);
        expect((await app.request("/readyz")).status).toBe(200);
        expect((await app.request("/livez")).status).toBe(200);

        await kernel.shutdown();
    });
});
