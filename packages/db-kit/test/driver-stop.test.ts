import { describe, test, expect } from "bun:test";
import { DbDriver } from "../src/driver";
import { QueryError } from "../src/errors";
import { App } from "@iskra-bun/core";

/**
 * MEDIUM finding (src/driver.ts:236): stop() has no try/catch, so a client whose
 * end()/close() throws aborts the orderly shutdown of every other driver in the
 * app. It also never nulls client/db, so a post-stop ping()/transaction() reaches
 * for an already-closed handle instead of the "not started" guard.
 *
 * FIXED behavior pinned here:
 *   1. stop() swallows a throwing close()/end() (logging via app.logger) and
 *      resolves rather than rejecting.
 *   2. After stop(), client and db are undefined, so ping() returns false and
 *      transaction() throws the not-started QueryError.
 */
describe("DbDriver.stop hardening", () => {
    test("swallows a throwing close() and resolves without rejecting", async () => {
        const app = new App({
            name: "StopThrowClose",
            db: { driver: "sqlite", url: ":memory:" },
        });
        const driver = new DbDriver();
        app.register(driver);
        await app.start();

        // Replace the live client with one whose close() throws, mirroring a
        // bun:sqlite / libsql handle that errors on teardown.
        (driver as any).client = {
            close: () => {
                throw new Error("close exploded");
            },
        };

        // Must not reject — a throwing teardown cannot abort orderly shutdown.
        await expect(driver.stop()).resolves.toBeUndefined();
    });

    test("swallows a throwing end() and resolves without rejecting", async () => {
        const app = new App({
            name: "StopThrowEnd",
            db: { driver: "sqlite", url: ":memory:" },
        });
        const driver = new DbDriver();
        app.register(driver);
        await app.start();

        // mysql2 / postgres-js expose async end(); simulate it rejecting.
        (driver as any).client = {
            end: async () => {
                throw new Error("end rejected");
            },
        };

        await expect(driver.stop()).resolves.toBeUndefined();
    });

    test("nulls client and db after stop so a later ping() returns false", async () => {
        const app = new App({
            name: "StopNullsHandlePing",
            db: { driver: "sqlite", url: ":memory:" },
        });
        const driver = new DbDriver();
        app.register(driver);
        await app.start();

        expect(driver.db).toBeDefined();

        await driver.stop();

        expect(driver.db).toBeUndefined();
        expect((driver as any).client).toBeUndefined();
        // ping must hit the not-started guard, not a closed handle.
        expect(await driver.ping()).toBe(false);
    });

    test("nulls db after stop so a later transaction() hits the not-started guard", async () => {
        const app = new App({
            name: "StopNullsHandleTx",
            db: { driver: "sqlite", url: ":memory:" },
        });
        const driver = new DbDriver();
        app.register(driver);
        await app.start();

        await driver.stop();

        // transaction() guards on `!this.db` and throws the not-started QueryError.
        try {
            await driver.transaction(async () => 1);
            expect(true).toBe(false); // should not reach
        } catch (err) {
            expect(err).toBeInstanceOf(QueryError);
            expect((err as QueryError).message).toContain("not started");
        }
    });

    test("a throwing teardown still nulls the handles", async () => {
        const app = new App({
            name: "StopThrowStillNulls",
            db: { driver: "sqlite", url: ":memory:" },
        });
        const driver = new DbDriver();
        app.register(driver);
        await app.start();

        (driver as any).client = {
            close: () => {
                throw new Error("close exploded");
            },
        };

        await driver.stop();

        expect((driver as any).client).toBeUndefined();
        expect(driver.db).toBeUndefined();
    });
});
