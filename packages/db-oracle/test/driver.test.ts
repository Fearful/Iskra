import { describe, test, expect, beforeAll, afterAll, spyOn } from "bun:test";
import { OracleDriver } from "../src/driver";
import { App } from "@iskra-bun/core";

const FAKE_BRIDGE = `${import.meta.dir}/fake-bridge.cjs`;

function makeApp() {
    return new App({ name: "OracleTest", logger: { level: "error" } });
}

describe("OracleDriver", () => {
    test("instantiates with default name", () => {
        const driver = new OracleDriver();
        expect(driver.name).toBe("db");
    });

    test("init registers itself in app context under 'oracle'", async () => {
        const app = makeApp();
        const driver = new OracleDriver(FAKE_BRIDGE);
        await driver.init(app);
        expect(app.context.get("oracle")).toBe(driver);
    });

    test("query throws when the driver has not been started", async () => {
        const driver = new OracleDriver(FAKE_BRIDGE);
        await expect(driver.query("SELECT 1 FROM dual")).rejects.toThrow("not started");
    });

    test("start does nothing (and logs a warning) when ORA_CONN is unset", async () => {
        const prev = process.env.ORA_CONN;
        delete process.env.ORA_CONN;
        try {
            const driver = new OracleDriver(FAKE_BRIDGE);
            await driver.start();
            // No subprocess was spawned, so queries still fail.
            await expect(driver.query("SELECT 1")).rejects.toThrow("not started");
        } finally {
            if (prev !== undefined) process.env.ORA_CONN = prev;
        }
    });
});

describe("OracleDriver bridge protocol", () => {
    const prevConn = process.env.ORA_CONN;
    let driver: OracleDriver;

    beforeAll(async () => {
        process.env.ORA_CONN = "fake://localhost/test";
        driver = new OracleDriver(FAKE_BRIDGE);
        await driver.init(makeApp());
        await driver.start();
    });

    afterAll(async () => {
        await driver.stop();
        if (prevConn !== undefined) process.env.ORA_CONN = prevConn;
        else delete process.env.ORA_CONN;
    });

    test("resolves a query with the rows returned by the bridge", async () => {
        const rows = await driver.query("SELECT name FROM users", [1, 2]);
        expect(rows).toEqual([{ echo: "SELECT name FROM users", params: [1, 2] }]);
    });

    test("defaults params to an empty array", async () => {
        const rows = await driver.query("SELECT 1 FROM dual");
        expect(rows).toEqual([{ echo: "SELECT 1 FROM dual", params: [] }]);
    });

    test("rejects when the bridge reports an error for the request", async () => {
        await expect(driver.query("SELECT FAIL")).rejects.toThrow("simulated query failure");
    });

    test("correlates concurrent queries to their own responses by id", async () => {
        const [a, b] = await Promise.all([
            driver.query("QUERY A"),
            driver.query("QUERY B"),
        ]);
        expect(a).toEqual([{ echo: "QUERY A", params: [] }]);
        expect(b).toEqual([{ echo: "QUERY B", params: [] }]);
    });

    test("recovers from a malformed line emitted by the bridge", async () => {
        const errSpy = spyOn(console, "error").mockImplementation(() => {});
        try {
            const rows = await driver.query("BAD_JSON_TEST");
            expect(rows).toEqual([{ recovered: true }]);
            expect(errSpy).toHaveBeenCalled();
        } finally {
            errSpy.mockRestore();
        }
    });

    test("a fatal message rejects all pending promises including the triggering query", async () => {
        const errSpy = spyOn(console, "error").mockImplementation(() => {});
        try {
            // Fire the fatal-triggering query and capture (don't await) so we can
            // assert it rejects rather than hangs.
            const fatalPromise = driver.query("FATAL_TEST").catch((e) => e);
            const err = await fatalPromise;
            expect(err).toBeInstanceOf(Error);
            expect((err as Error).message).toMatch(/fatal/i);
            expect(errSpy).toHaveBeenCalled();
        } finally {
            errSpy.mockRestore();
        }
    });
});
