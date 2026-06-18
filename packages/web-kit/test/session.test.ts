import { describe, expect, it } from "bun:test";
import { Kernel } from "../src/kernel";
import { SessionFeature } from "../src/features/session";
import { CacheFeature } from "../src/features/cache";

describe("Session Feature", () => {
    it("should initialize with memory store", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new SessionFeature({
            store: "memory",
            secret: "test-secret-key",
        }));
        await kernel.initialize();

        const app = kernel.getApp();
        app.get("/session", (c) => {
            const session = c.get("session");
            return c.json({ session, sessionId: c.get("sessionId") });
        });

        const res = await app.request("/session");
        expect(res.status).toBe(200);
        const json = await res.json() as any;
        expect(json.sessionId).toBeDefined();
        expect(json.session).toEqual({});

        await kernel.shutdown();
    });

    it("should create session and set cookie on write", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new SessionFeature({
            store: "memory",
            secret: "test-secret",
        }));
        await kernel.initialize();

        const app = kernel.getApp();
        app.get("/login", (c) => {
            const session = c.get("session");
            session.user = "testuser";
            session.role = "admin";
            return c.json({ ok: true });
        });

        const res = await app.request("/login");
        expect(res.status).toBe(200);

        // Check that a Set-Cookie header was set
        const setCookie = res.headers.get("Set-Cookie");
        expect(setCookie).toBeDefined();
        expect(setCookie).toContain("sid=");

        await kernel.shutdown();
    });

    it("should restore session from signed cookie", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new SessionFeature({
            store: "memory",
            secret: "restore-test-secret",
        }));
        await kernel.initialize();

        const app = kernel.getApp();

        app.get("/set", (c) => {
            const session = c.get("session");
            session.value = "persisted";
            return c.json({ sessionId: c.get("sessionId") });
        });

        app.get("/get", (c) => {
            return c.json({ session: c.get("session") });
        });

        // Set session
        const setRes = await app.request("/set");
        const setCookie = setRes.headers.get("Set-Cookie");
        expect(setCookie).toBeDefined();

        // Extract cookie value
        const cookieValue = setCookie!.split(";")[0]; // "sid=..."

        // Get session with cookie
        const getRes = await app.request("/get", {
            headers: { Cookie: cookieValue },
        });
        const json = await getRes.json() as any;
        expect(json.session.value).toBe("persisted");

        await kernel.shutdown();
    });

    it("should reject tampered cookies", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new SessionFeature({
            store: "memory",
            secret: "tamper-test",
        }));
        await kernel.initialize();

        const app = kernel.getApp();
        app.get("/check", (c) => {
            return c.json({ session: c.get("session"), id: c.get("sessionId") });
        });

        // Send a tampered cookie
        const res = await app.request("/check", {
            headers: { Cookie: "sid=fake-id.invalid-signature" },
        });
        const json = await res.json() as any;
        // Should get a new empty session (tampered cookie rejected)
        expect(json.session).toEqual({});

        await kernel.shutdown();
    });

    it("should initialize with cache store", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new CacheFeature({ adapter: "memory" }));
        kernel.registerFeature(new SessionFeature({
            store: "cache",
            secret: "cache-session-test",
        }));
        await kernel.initialize();

        const app = kernel.getApp();
        app.get("/session", (c) => {
            const session = c.get("session");
            session.data = "from-cache-store";
            return c.json({ ok: true });
        });

        const res = await app.request("/session");
        expect(res.status).toBe(200);

        await kernel.shutdown();
    });

    it("persists, restores and destroys a session via the cache store", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new CacheFeature({ adapter: "memory" }));
        kernel.registerFeature(new SessionFeature({ store: "cache", secret: "cache-restore" }));
        await kernel.initialize();

        const app = kernel.getApp();
        app.get("/set", (c) => {
            c.get("session").v = "cached";
            return c.json({ ok: true });
        });
        app.get("/get", (c) => c.json({ session: c.get("session") }));
        app.get("/logout", async (c) => {
            await c.get("destroySession")();
            return c.json({ ok: true });
        });

        const setRes = await app.request("/set");
        const cookie = setRes.headers.get("Set-Cookie")!.split(";")[0];

        // Second request with the cookie reads the value back through CacheSessionStore.get
        const getJson = (await (await app.request("/get", { headers: { Cookie: cookie } })).json()) as any;
        expect(getJson.session.v).toBe("cached");

        // destroySession routes through CacheSessionStore.destroy
        const logoutRes = await app.request("/logout", { headers: { Cookie: cookie } });
        expect(logoutRes.status).toBe(200);

        await kernel.shutdown();
    });

    it("should support custom cookie name", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new SessionFeature({
            store: "memory",
            secret: "custom-cookie",
            cookieName: "my_session",
        }));
        await kernel.initialize();

        const app = kernel.getApp();
        app.get("/custom", (c) => {
            const session = c.get("session");
            session.test = true;
            return c.json({ ok: true });
        });

        const res = await app.request("/custom");
        const setCookie = res.headers.get("Set-Cookie");
        expect(setCookie).toContain("my_session=");

        await kernel.shutdown();
    });

    it("should support destroySession", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new SessionFeature({
            store: "memory",
            secret: "destroy-test",
        }));
        await kernel.initialize();

        const app = kernel.getApp();
        app.get("/logout", async (c) => {
            const destroy = c.get("destroySession");
            await destroy();
            return c.json({ ok: true });
        });

        const res = await app.request("/logout");
        expect(res.status).toBe(200);

        await kernel.shutdown();
    });

    it("destroySession ends the session even if the handler does not clear it", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new SessionFeature({
            store: "memory",
            secret: "destroy-real",
        }));
        await kernel.initialize();

        const app = kernel.getApp();
        app.get("/login", (c) => {
            c.get("session").user = "ada";
            return c.json({ ok: true });
        });
        app.get("/me", (c) => c.json({ session: c.get("session") }));
        // Deliberately does NOT clear the session object — destroySession alone must suffice.
        app.get("/logout", async (c) => {
            await c.get("destroySession")();
            return c.json({ ok: true });
        });

        const cookie = (await app.request("/login")).headers.get("Set-Cookie")!.split(";")[0];

        const before = await (await app.request("/me", { headers: { Cookie: cookie } })).json() as any;
        expect(before.session.user).toBe("ada");

        await app.request("/logout", { headers: { Cookie: cookie } });

        // The destroyed session must NOT be re-persisted by the save-after-response logic.
        const after = await (await app.request("/me", { headers: { Cookie: cookie } })).json() as any;
        expect(after.session).toEqual({});

        await kernel.shutdown();
    });
});
