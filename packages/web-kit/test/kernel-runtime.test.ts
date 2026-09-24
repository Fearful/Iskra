import { describe, it, expect } from "bun:test";
import { Kernel } from "../src/kernel";
import { HealthCheckFeature } from "../src/features/health";
import { DbFeature } from "../src/features/db";

const PG_URL = process.env.TEST_PG_URL || "postgres://postgres:postgres@127.0.0.1:5432/postgres";
const MYSQL_URL = process.env.TEST_MYSQL_URL || "mysql://root:mysql@127.0.0.1:3306/test";

async function reachable(check: () => Promise<unknown>) {
    try {
        await check();
        return true;
    } catch {
        return false;
    }
}
const pgUp = await reachable(async () => {
    const sql = (await import("postgres")).default(PG_URL, { max: 1, connect_timeout: 2, onnotice: () => {} });
    try { await sql`select 1`; } finally { await sql.end({ timeout: 1 }); }
});
const mysqlUp = await reachable(async () => {
    const conn = await (await import("mysql2/promise")).default.createConnection(MYSQL_URL);
    try { await conn.query("select 1"); } finally { await conn.end(); }
});

describe("/health reflects failures", () => {
    it("answers 503 when a check fails, even without includeDetails", async () => {
        // Regression: checks only ran with includeDetails, and /health was always 200.
        const kernel = new Kernel();
        kernel.registerFeature(new HealthCheckFeature({ checks: { broken: async () => ({ status: "error" }) } }));
        await kernel.initialize();

        const res = await kernel.getApp().request("/health");
        expect(res.status).toBe(503);
        expect(((await res.json()) as any).status).toBe("error");
        await kernel.shutdown();
    });

    it("probes a real DbFeature and reports a dead connection", async () => {
        // Regression: the probe called db.query("SELECT 1"), but on a Drizzle
        // instance `query` is an object, so the database was never checked.
        const kernel = new Kernel();
        const db = new DbFeature({ adapter: "sqlite", connection: { database: ":memory:" } });
        kernel.registerFeature(db);
        kernel.registerFeature(new HealthCheckFeature({ includeDetails: true }));
        await kernel.initialize();
        const app = kernel.getApp();

        const ok = await app.request("/health");
        expect(ok.status).toBe(200);
        expect(((await ok.json()) as any).checks.db).toEqual({ status: "ok" });

        await db.shutdown(); // closes the sqlite handle
        const down = await app.request("/health");
        expect(down.status).toBe(503);
        expect(((await down.json()) as any).checks.db).toEqual({ status: "error" });
    });

    it("times out a hanging check instead of hanging the probe", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(
            new HealthCheckFeature({ checkTimeoutMs: 50, checks: { stuck: () => new Promise(() => {}) } }),
        );
        await kernel.initialize();
        const started = Date.now();
        expect((await kernel.getApp().request("/health")).status).toBe(503);
        expect(Date.now() - started).toBeLessThan(1000);
        await kernel.shutdown();
    });
});

describe("DbFeature.ping", () => {
    const adapters: [boolean, string, ConstructorParameters<typeof DbFeature>[0]][] = [
        [true, "sqlite", { adapter: "sqlite", connection: { database: ":memory:" } }],
        [pgUp, "postgres (requires Postgres)", { adapter: "postgres", connection: { connectionString: PG_URL } }],
        [mysqlUp, "mysql (requires MySQL)", { adapter: "mysql", connection: { connectionString: MYSQL_URL } }],
    ];
    for (const [enabled, label, config] of adapters) {
        it.if(enabled)(`round-trips on ${label}`, async () => {
            const kernel = new Kernel();
            const db = new DbFeature(config);
            kernel.registerFeature(db);
            await kernel.initialize();
            await expect(db.ping()).resolves.toBeUndefined();
            await kernel.shutdown();
        });
    }
});

describe("Kernel runtime", () => {
    it("shuts down every feature in reverse dependency order, even if one fails", async () => {
        const order: string[] = [];
        const feature = (name: string, dependencies: string[] = [], fail = false) => ({
            name,
            dependencies,
            async initialize() {},
            async shutdown() {
                order.push(name);
                if (fail) throw new Error(`${name} failed`);
            },
        });
        const kernel = new Kernel();
        // Registered out of order on purpose: shutdown follows dependencies.
        kernel.registerFeature(feature("auth", ["db"], true));
        kernel.registerFeature(feature("db"));
        kernel.registerFeature(feature("api", ["auth"]));
        await kernel.initialize();

        const err = await kernel.shutdown().catch((e) => e);
        expect(err).toBeInstanceOf(AggregateError);
        expect(order).toEqual(["api", "auth", "db"]);
    });

    it("keeps default security headers when only one is overridden", async () => {
        // Regression: passing securityHeaders replaced all defaults.
        const kernel = new Kernel({ securityHeaders: { referrerPolicy: "no-referrer" } });
        await kernel.initialize();
        kernel.getApp().get("/", (c) => c.text("ok"));
        const res = await kernel.getApp().request("/");
        expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
        expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
        expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
        expect(res.headers.get("X-XSS-Protection")).toBeNull();
    });

    it("does not crash on a missing peer dependency", async () => {
        // Regression: an un-awaited import() in a sync try/catch became an
        // unhandled rejection that failed the process.
        const kernel = new Kernel();
        kernel.registerFeature({
            name: "needs-peer",
            peerDependencies: ["iskra-definitely-not-installed-pkg"],
            async initialize() {},
        });
        await expect(kernel.initialize()).resolves.toBeUndefined();
        await new Promise((r) => setTimeout(r, 20));
    });

    it("binds all interfaces by default and enforces maxRequestBodySize", async () => {
        expect(new Kernel().getConfig().hostname).toBe("0.0.0.0");

        const kernel = new Kernel({ port: 0, maxRequestBodySize: 1024, shutdownGraceMs: 200 });
        kernel.getApp().post("/echo", async (c) => c.text(String((await c.req.text()).length)));
        await kernel.start();
        const port = (kernel as any).server.port;
        const small = await fetch(`http://127.0.0.1:${port}/echo`, { method: "POST", body: "x".repeat(100) });
        expect(await small.text()).toBe("100");
        const big = await fetch(`http://127.0.0.1:${port}/echo`, { method: "POST", body: "x".repeat(10_000) });
        expect(big.status).toBe(413);

        // Bun 1.1's graceful stop never settles after a 413; shutdown must still finish.
        const started = Date.now();
        await kernel.shutdown();
        expect(Date.now() - started).toBeLessThan(2000);
    });
});
