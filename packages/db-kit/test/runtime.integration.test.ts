import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "@iskra-bun/core";
import { sql } from "drizzle-orm";
import { DbDriver } from "../src/driver";
import { ConnectionError, MigrationError } from "../src/errors";

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

const dirs: string[] = [];
afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** A migrations folder in the layout `drizzle-kit generate` writes. */
function migrationsFolder(dialect: string, table: string, when: number): string {
    const dir = mkdtempSync(join(tmpdir(), "iskra-mig-"));
    dirs.push(dir);
    mkdirSync(join(dir, "meta"));
    writeFileSync(
        join(dir, "meta", "_journal.json"),
        JSON.stringify({ version: "7", dialect, entries: [{ idx: 0, version: "7", when, tag: "0000_init", breakpoints: true }] }),
    );
    writeFileSync(join(dir, "0000_init.sql"), `CREATE TABLE ${table} (id integer PRIMARY KEY, label varchar(50));`);
    return dir;
}

async function started(db: { driver: "postgres" | "mysql" | "sqlite"; url: string }) {
    const app = new App({ name: "DbRuntime", logger: { level: "silent" }, db });
    const driver = new DbDriver();
    app.register(driver);
    await app.start();
    return { app, driver };
}

const dialects: [boolean, string, { driver: "postgres" | "mysql" | "sqlite"; url: string }, string][] = [
    [true, "sqlite", { driver: "sqlite", url: ":memory:" }, "sqlite"],
    [pgUp, "postgres (requires Postgres)", { driver: "postgres", url: PG_URL }, "postgresql"],
    [mysqlUp, "mysql (requires MySQL)", { driver: "mysql", url: MYSQL_URL }, "mysql"],
];

describe("DbDriver.runMigrations applies generated migrations", () => {
    for (const [enabled, label, config, dialect] of dialects) {
        test.if(enabled)(label, async () => {
            // Regression: it shelled out to `drizzle-kit migrate`, ignoring
            // migrationsDir, and failed without a drizzle.config.ts.
            // Postgres/MySQL keep drizzle's migrations table between runs and only
            // apply entries newer than the last one recorded, so use a fresh timestamp.
            const when = Date.now();
            const table = `iskra_mig_${when}`;
            const { app, driver } = await started(config);
            try {
                await driver.runMigrations(undefined, migrationsFolder(dialect, table, when));
                const handle = driver.db as any;
                const insert = sql.raw(`INSERT INTO ${table} (id, label) VALUES (1, 'ok')`);
                if (typeof handle.run === "function") await handle.run(insert);
                else await handle.execute(insert);
                // Running again is a no-op (already applied).
                await driver.runMigrations(undefined, migrationsFolder(dialect, table, when));
            } finally {
                const journal = config.driver === "postgres" ? "drizzle.__drizzle_migrations" : "__drizzle_migrations";
                const handle = driver.db as any;
                for (const stmt of [`DROP TABLE IF EXISTS ${table}`, `DELETE FROM ${journal} WHERE created_at = ${when}`]) {
                    if (typeof handle?.run === "function") await handle.run(sql.raw(stmt));
                    else await handle?.execute(sql.raw(stmt));
                }
                await app.stop();
            }
        });
    }

    test("wraps a failing migration in MigrationError", async () => {
        const { app, driver } = await started({ driver: "sqlite", url: ":memory:" });
        try {
            await expect(driver.runMigrations(undefined, "/nonexistent/migrations")).rejects.toBeInstanceOf(MigrationError);
        } finally {
            await app.stop();
        }
    });
});

describe("DbDriver.start verifies the connection", () => {
    test("fails start() when Postgres is unreachable", async () => {
        // Regression: postgres-js connects lazily, so start() logged "DB
        // connected successfully" and the first query failed later.
        const app = new App({
            name: "DbUnreachable",
            logger: { level: "silent" },
            db: { driver: "postgres", url: "postgres://nobody:secret@127.0.0.1:1/none?connect_timeout=2" },
        });
        app.register(new DbDriver());
        const error = await app.start().then(() => null, (e) => e);
        expect(error).toBeInstanceOf(ConnectionError);
        // The password never appears in the error.
        expect(JSON.stringify(error.context)).not.toContain("secret");
    });
});
