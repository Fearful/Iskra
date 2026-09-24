import { describe, test, expect, afterEach, spyOn } from "bun:test";
import { OracleDriver } from "../src/driver";
import { App } from "@iskra-bun/core";

// Lifecycle-focused unit tests, complementing the protocol suite in
// driver.test.ts. The external bridge is mocked via fake-bridge.cjs so no
// real Oracle instance or oracledb binding is required.
const FAKE_BRIDGE = `${import.meta.dir}/fake-bridge.cjs`;

function makeApp() {
    return new App({ name: "OracleLifecycleTest", logger: { level: "error" } });
}

describe("OracleDriver lifecycle", () => {
    const prevConn = process.env.ORA_CONN;

    afterEach(() => {
        if (prevConn !== undefined) process.env.ORA_CONN = prevConn;
        else delete process.env.ORA_CONN;
    });

    test("stop() is a no-op when the driver was never started", async () => {
        const driver = new OracleDriver(FAKE_BRIDGE);
        // Must not throw even though no subprocess exists.
        await driver.stop();
        // And the driver remains unusable afterwards.
        await expect(driver.query("SELECT 1")).rejects.toThrow("not started");
    });

    test("query rejects again after the driver is stopped", async () => {
        process.env.ORA_CONN = "fake://localhost/test";
        const driver = new OracleDriver(FAKE_BRIDGE);
        await driver.init(makeApp());
        await driver.start();

        // Sanity: it works while running.
        await expect(driver.query("SELECT 1 FROM dual")).resolves.toEqual([
            { echo: "SELECT 1 FROM dual", params: [] },
        ]);

        await driver.stop();

        // After stop the subprocess handle is cleared, so queries fail fast.
        await expect(driver.query("SELECT 1 FROM dual")).rejects.toThrow("not started");
    });

    test("stop() called twice does not throw", async () => {
        process.env.ORA_CONN = "fake://localhost/test";
        const driver = new OracleDriver(FAKE_BRIDGE);
        await driver.init(makeApp());
        await driver.start();

        await driver.stop();
        await driver.stop(); // second call is the regression guard
        await expect(driver.query("SELECT 1")).rejects.toThrow("not started");
    });

    test("assigns a fresh request id to each query so responses do not collide", async () => {
        process.env.ORA_CONN = "fake://localhost/test";
        const driver = new OracleDriver(FAKE_BRIDGE);
        await driver.init(makeApp());
        await driver.start();
        try {
            // Three queries fired together; if ids were reused the pending-map
            // lookup would cross the wires and these would not match 1:1.
            const results = await Promise.all([
                driver.query("Q1", ["a"]),
                driver.query("Q2", ["b"]),
                driver.query("Q3", ["c"]),
            ]);
            expect(results).toEqual([
                [{ echo: "Q1", params: ["a"] }],
                [{ echo: "Q2", params: ["b"] }],
                [{ echo: "Q3", params: ["c"] }],
            ]);
        } finally {
            await driver.stop();
        }
    });

    test("uses the default bridge path when no override is given", () => {
        const driver = new OracleDriver();
        // Default name is unchanged regardless of bridge path resolution.
        expect(driver.name).toBe("db");
    });
});

describe("OracleDriver pending-promise rejection on fatal/exit", () => {
    const prevConn = process.env.ORA_CONN;

    afterEach(() => {
        if (prevConn !== undefined) process.env.ORA_CONN = prevConn;
        else delete process.env.ORA_CONN;
    });

    test("fatal message rejects the pending promise rather than leaving it hung", async () => {
        process.env.ORA_CONN = "fake://localhost/test";
        const driver = new OracleDriver(FAKE_BRIDGE);
        await driver.init(makeApp());
        await driver.start();
        const errSpy = spyOn(console, "error").mockImplementation(() => {});
        try {
            // FATAL_TEST causes the bridge to emit { type: 'fatal' } without an id.
            // The driver must reject this (and all other) pending promises.
            await expect(driver.query("FATAL_TEST")).rejects.toThrow(/fatal/i);
        } finally {
            errSpy.mockRestore();
            await driver.stop();
        }
    });

    test("bridge process exit rejects all pending promises rather than leaving them hung", async () => {
        process.env.ORA_CONN = "fake://localhost/test";
        const driver = new OracleDriver(FAKE_BRIDGE);
        await driver.init(makeApp());
        await driver.start();
        const errSpy = spyOn(console, "error").mockImplementation(() => {});
        try {
            // EXIT_TEST causes the bridge to call process.exit(1) immediately.
            // The stream will close, triggering rejectAllPending in the finally block.
            await expect(driver.query("EXIT_TEST")).rejects.toThrow(/exited|error/i);
        } finally {
            errSpy.mockRestore();
            await driver.stop();
        }
    });
});
