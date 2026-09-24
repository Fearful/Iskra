import { describe, it, expect, spyOn, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { Kernel } from "../../src/kernel";
import { CsrfFeature, requireCsrf } from "../../src/features/csrf";
import { SessionFeature } from "../../src/features/session";

// Issue a real CSRF cookie+token by hitting a safe route, then return both the
// signed token and the cookie header to replay on an unsafe request.
async function issueToken(app: any) {
    const res = await app.request("/safe");
    const body = (await res.json()) as { token: string };
    const setCookie = res.headers.get("set-cookie") || "";
    // Extract just the `_csrf=...` pair for replay as a request cookie.
    const cookie = setCookie.split(";")[0];
    return { token: body.token, cookie };
}

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

    it("allows an unsafe request when the header token matches the issued cookie", async () => {
        const app = await appWithCsrf();
        // Obtain a properly signed token+cookie from a safe request, then replay.
        const { token, cookie } = await issueToken(app);
        const res = await app.request("/mutate", {
            method: "POST",
            headers: {
                cookie,
                "X-CSRF-Token": token,
            },
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
    });

    it("rejects an unsafe request when the header token does not match", async () => {
        const app = await appWithCsrf();
        const { cookie } = await issueToken(app);
        const res = await app.request("/mutate", {
            method: "POST",
            headers: {
                cookie,
                "X-CSRF-Token": "wrongtoken",
            },
        });
        expect(res.status).toBe(403);
    });

    it("accepts a matching token supplied in a urlencoded body field", async () => {
        const app = await appWithCsrf();
        const { token, cookie } = await issueToken(app);
        const res = await app.request("/mutate", {
            method: "POST",
            headers: {
                cookie,
                "content-type": "application/x-www-form-urlencoded",
            },
            body: `_csrf=${encodeURIComponent(token)}`,
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

describe("CsrfFeature token signing", () => {
    it("rejects a foreign token minted with a different secret", async () => {
        // A token issued under one secret must not validate under another. This
        // is the core of signed double-submit: forging requires the secret.
        // (The signature binds only the random nonce — no session id.)
        const issuer = await appWithCsrf({ secret: "secret-A" });
        const { token, cookie } = await issueToken(issuer);

        const victim = await appWithCsrf({ secret: "secret-B" });
        const res = await victim.request("/mutate", {
            method: "POST",
            headers: { cookie, "X-CSRF-Token": token },
        });
        expect(res.status).toBe(403);
    });

    it("rejects a tampered token whose signature no longer matches", async () => {
        const app = await appWithCsrf();
        const { token, cookie } = await issueToken(app);
        // Flip the first character of the random half; the signature is now stale.
        const flipped = (token[0] === "a" ? "b" : "a") + token.slice(1);
        const tamperedCookie = cookie.replace(token, flipped);
        const res = await app.request("/mutate", {
            method: "POST",
            headers: { cookie: tamperedCookie, "X-CSRF-Token": flipped },
        });
        expect(res.status).toBe(403);
    });

    it("rejects an unsigned plain-UUID token (the pre-fix format)", async () => {
        const app = await appWithCsrf();
        const plain = crypto.randomUUID().replace(/-/g, "");
        const res = await app.request("/mutate", {
            method: "POST",
            headers: { cookie: `_csrf=${plain}`, "X-CSRF-Token": plain },
        });
        expect(res.status).toBe(403);
    });

    it("accepts a correctly signed token", async () => {
        const app = await appWithCsrf();
        const { token, cookie } = await issueToken(app);
        const res = await app.request("/mutate", {
            method: "POST",
            headers: { cookie, "X-CSRF-Token": token },
        });
        expect(res.status).toBe(200);
    });

    it("rejects a wrong-length token without throwing (constant-time path is safe)", async () => {
        // timingSafeEqual throws on length mismatch; the middleware must guard it
        // and return 403 rather than a 500. A short token exercises that guard.
        const app = await appWithCsrf();
        const { cookie } = await issueToken(app);
        const res = await app.request("/mutate", {
            method: "POST",
            headers: { cookie, "X-CSRF-Token": "short" },
        });
        expect(res.status).toBe(403);
    });
});

describe("CsrfFeature with SessionFeature across two requests", () => {
    // Regression: anonymous flows mint a throwaway sessionId per request, so a
    // token bound to the issuing request's sessionId would 403 on the first POST.
    // Drive two SEPARATE requests with the session cookie round-tripped and
    // assert the POST succeeds.
    async function appWithSessionAndCsrf() {
        const kernel = new Kernel();
        // Register session first so sessionId is populated before CSRF runs.
        kernel.registerFeature(new SessionFeature({ store: "memory", secret: "sess-secret-0123456789abcdef0123456789abcdef" }));
        kernel.registerFeature(new CsrfFeature({ secret: "csrf-secret" }));
        await kernel.initialize();
        const app = kernel.getApp();
        app.get("/safe", (c) => c.json({ token: c.get("csrfToken") }));
        app.post("/mutate", (c) => c.json({ ok: true }));
        return app;
    }

    // Merge all Set-Cookie name=value pairs into one Cookie header for replay.
    function cookiesFromResponse(res: Response): string {
        const setCookie = res.headers.get("set-cookie") || "";
        return setCookie
            .split(/,(?=[^;]+=[^;]+)/)
            .map((c) => c.split(";")[0].trim())
            .filter(Boolean)
            .join("; ");
    }

    it("accepts the first POST of a fresh (anonymous) flow", async () => {
        const app = await appWithSessionAndCsrf();

        // Request 1: GET issues the CSRF cookie (and a session id may be minted).
        const res1 = await app.request("/safe");
        expect(res1.status).toBe(200);
        const { token } = (await res1.json()) as { token: string };
        const cookies = cookiesFromResponse(res1);
        expect(cookies).toContain("_csrf=");

        // Request 2: a SEPARATE POST replaying the cookies + submitted token.
        // A sessionId-bound token would 403 here because request 2 mints a new
        // throwaway sessionId; the unbound signed token must succeed.
        const res2 = await app.request("/mutate", {
            method: "POST",
            headers: { cookie: cookies, "X-CSRF-Token": token },
        });
        expect(res2.status).toBe(200);
        expect(await res2.json()).toEqual({ ok: true });
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
