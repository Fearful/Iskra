import { describe, it, expect } from "bun:test";
import * as authKit from "../src/index";

// Guards the public API surface of the barrel: the config factory, the three
// Drizzle schema dictionaries, and the individual tables must all be re-exported.
describe("@iskra-bun/auth-kit barrel", () => {
    it("re-exports the better-auth config factory", () => {
        expect(typeof authKit.createBetterAuth).toBe("function");
    });

    it("re-exports the three dialect schema dictionaries", () => {
        expect(authKit.pgSchema).toBeDefined();
        expect(authKit.mysqlSchema).toBeDefined();
        expect(authKit.sqliteSchema).toBeDefined();
    });

    it("re-exports the individual auth tables", () => {
        for (const name of [
            "pgUser",
            "pgSession",
            "pgAccount",
            "pgVerification",
            "mysqlUser",
            "sqliteUser",
        ] as const) {
            expect(authKit[name]).toBeDefined();
        }
    });
});
