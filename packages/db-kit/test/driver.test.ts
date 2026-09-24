import { describe, test, expect, afterEach, spyOn } from "bun:test";
import { DbDriver } from "../src/driver";
import { ConnectionError, QueryError } from "../src/errors";
import { App, DriverError, IskraError } from "@iskra-bun/core";

describe("DbDriver", () => {
    test("instantiates", () => {
        const driver = new DbDriver();
        expect(driver.name).toBe("db");
    });

    test("skips initialization when no DB config is provided", async () => {
        const app = new App({ name: "NoDBTest" });
        const driver = new DbDriver();
        app.register(driver);
        await app.start();
        expect(driver.db).toBeUndefined();
        await app.stop();
    });

    test("connects to SQLite in-memory database", async () => {
        const app = new App({
            name: "SQLiteTest",
            db: { driver: "sqlite", url: ":memory:" },
        });
        const driver = new DbDriver();
        app.register(driver);
        await app.start();

        expect(driver.db).toBeDefined();

        // Use the underlying client for raw queries (Drizzle db.all requires query objects)
        const client = (driver as any).client;
        const result = client.query("SELECT 1 + 1 as sum").all();
        expect(result).toBeDefined();
        expect(result[0].sum).toBe(2);

        await app.stop();
    });

    test("connects to SQLite file database", async () => {
        const testDbPath = "/tmp/iskra-test-" + Date.now() + ".db";
        const app = new App({
            name: "SQLiteFileTest",
            db: { driver: "sqlite", url: testDbPath },
        });
        const driver = new DbDriver();
        app.register(driver);
        await app.start();

        expect(driver.db).toBeDefined();

        // Use underlying client for raw SQL
        const client = (driver as any).client;
        client.exec("CREATE TABLE test_table (id INTEGER PRIMARY KEY, name TEXT)");
        client.exec("INSERT INTO test_table (name) VALUES ('iskra')");
        const rows = client.query("SELECT * FROM test_table").all();
        expect(rows.length).toBe(1);
        expect(rows[0].name).toBe("iskra");

        await app.stop();

        // Cleanup
        try { const fs = await import("fs/promises"); await fs.unlink(testDbPath); } catch { /* ignored */ }
    });

    test("throws DriverError for unsupported driver", async () => {
        const app = new App({
            name: "BadDriverTest",
            db: { driver: "unsupported" as any, url: "nope" },
        });
        const driver = new DbDriver();
        app.register(driver);

        try {
            await app.start();
            expect(true).toBe(false); // should not reach
        } catch (err) {
            expect(err).toBeInstanceOf(DriverError);
            expect((err as DriverError).code).toBe("DRIVER_START_FAILED");
        }
        await app.stop();
    });

    test("throws ConnectionError for invalid SQLite path", async () => {
        const app = new App({
            name: "BadPathTest",
            db: { driver: "sqlite", url: "/nonexistent/deep/path/db.sqlite" },
        });
        const driver = new DbDriver();
        app.register(driver);

        try {
            await app.start();
            expect(true).toBe(false);
        } catch (err) {
            expect(err).toBeInstanceOf(ConnectionError);
            expect((err as ConnectionError).code).toBe("CONNECTION_ERROR");
        }
    });

    test("sets itself in app context", async () => {
        const app = new App({
            name: "ContextTest",
            db: { driver: "sqlite", url: ":memory:" },
        });
        const driver = new DbDriver();
        app.register(driver);
        await app.start();

        expect(app.context.get("db")).toBe(driver);
        await app.stop();
    });
});

describe("db-kit error types", () => {
    test("QueryError carries the QUERY_ERROR code and preserves its cause", () => {
        const cause = new Error("syntax error at or near");
        const err = new QueryError("Query failed", { cause, context: { sql: "SELECT" } });
        expect(err).toBeInstanceOf(IskraError);
        expect(err.code).toBe("QUERY_ERROR");
        expect(err.name).toBe("QueryError");
        expect(err.cause).toBe(cause);
        expect(err.context).toEqual({ sql: "SELECT" });
    });
});

describe("DbDriver.runMigrations", () => {
    let spawnSpy: ReturnType<typeof spyOn> | null = null;

    afterEach(() => {
        spawnSpy?.mockRestore();
        spawnSpy = null;
    });

    test("throws DriverError when no DB config is present", async () => {
        const app = new App({ name: "NoDBMigrate" });
        const driver = new DbDriver();
        await driver.init(app);

        try {
            await driver.runMigrations("./schema.ts");
            expect(true).toBe(false);
        } catch (err) {
            expect(err).toBeInstanceOf(DriverError);
            expect((err as DriverError).code).toBe("DRIVER_START_FAILED");
        }
    });

    test("requires a started driver", async () => {
        const app = new App({ name: "MigrateNotStarted", db: { driver: "sqlite", url: ":memory:" } });
        const driver = new DbDriver();
        await driver.init(app);
        await expect(driver.runMigrations(undefined, "./drizzle")).rejects.toThrow(/not started/);
    });
});
