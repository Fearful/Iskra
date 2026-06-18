import { describe, it, expect, spyOn, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { Kernel } from "../../src/kernel";
import { CsrfFeature, requireCsrf } from "../../src/features/csrf";

// CsrfFeature wires middleware onto the kernel's Hono app. We drive it through
// app.request() to verify cookie issuance, safe-method passthrough, and
// header/body token validation. console.log is silenced during init.

let logSpy: ReturnType<typeof spyOn>;
beforeAll(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
});
afterAll(() => {
    logSpy.mockRestore();
});

async function appWithCsrf(config = { secret: "s3cr3t" }) {
    const kernel = new Kernel();
    const feature = new CsrfFeature(config);
    kernel.registerFeature(feature);
    await kernel.initialize();
    const app = kernel.getApp();
    app.get("/safe", (c) => c.json({ token: c.get("csrfToken") }));
    app.post("/mutate", (c) => c.json({ ok: true }));
    return app;
}

describe("CsrfFeature construction", () => {
    it("throws when no secret is provided", () => {
        expect(() => new CsrfFeature({} as any)).toThrow("CSRF secret is required");
    });

    it("constructs with a secret", () => {
        expect(new CsrfFeature({ secret: "abc" }).name).toBe("csrf");
    });
});

describe("CsrfFeature middleware", () => {
    it("issues a CSRF cookie on a safe (GET) request and exposes the token", async () => {
        const app = await appWithCsrf();
        const res = await app.request("/safe");
        expect(res.status).toBe(200);
        const setCookie = res.headers.get("set-cookie") || "";
        expect(setCookie).toContain("_csrf=");
        const body = (await res.json()) as { token: string };
        expect(typeof body.token).toBe("string");
        expect(body.token.length).toBeGreaterThan(0);
    });

    it("rejects an unsafe (POST) request with no matching token (403)", async () => {
        const app = await appWithCsrf();
        const res = await app.request("/mutate", { method: "POST" });
        expect(res.status).toBe(403);
    });

    it("allows an unsafe request when the header token matches the cookie", async () => {
        const app = await appWithCsrf();
        // Use a known token by presenting it as the cookie; the middleware
        // accepts the existing cookie and compares the header against it.
        const token = "abcdef0123456789";
        const res = await app.request("/mutate", {
            method: "POST",
            headers: {
                cookie: `_csrf=${token}`,
                "X-CSRF-Token": token,
            },
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
    });

    it("rejects an unsafe request when the header token does not match", async () => {
        const app = await appWithCsrf();
        const res = await app.request("/mutate", {
            method: "POST",
            headers: {
                cookie: "_csrf=correcttoken",
                "X-CSRF-Token": "wrongtoken",
            },
        });
        expect(res.status).toBe(403);
    });

    it("accepts a matching token supplied in a urlencoded body field", async () => {
        const app = await appWithCsrf();
        const token = "formtoken123";
        const res = await app.request("/mutate", {
            method: "POST",
            headers: {
                cookie: `_csrf=${token}`,
                "content-type": "application/x-www-form-urlencoded",
            },
            body: `_csrf=${token}`,
        });
        expect(res.status).toBe(200);
    });

    it("honors a custom header name and ignoreMethods config", async () => {
        const app = await appWithCsrf({
            secret: "s",
            headerName: "X-My-Csrf",
            ignoreMethods: ["GET", "HEAD", "OPTIONS", "DELETE"],
        } as any);
        app.delete("/mutate2", (c) => c.json({ deleted: true }));
        // DELETE is now an ignored method -> passes without a token.
        const res = await app.request("/mutate2", { method: "DELETE" });
        expect(res.status).toBe(200);
    });
});

describe("requireCsrf middleware", () => {
    it("throws 403 when no csrfToken is set on the context", async () => {
        const app = new Hono();
        app.post("/guarded", requireCsrf(), (c) => c.json({ ok: true }));
        const res = await app.request("/guarded", { method: "POST" });
        expect(res.status).toBe(403);
    });

    it("passes through when a csrfToken is present on the context", async () => {
        const app = new Hono();
        app.use("*", async (c, next) => {
            c.set("csrfToken", "present");
            await next();
        });
        app.post("/guarded", requireCsrf(), (c) => c.json({ ok: true }));
        const res = await app.request("/guarded", { method: "POST" });
        expect(res.status).toBe(200);
    });
});
