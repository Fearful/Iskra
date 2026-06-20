import { describe, it, expect } from "bun:test";
import {
    pgSchema,
    mysqlSchema,
    sqliteSchema,
    pgUser,
    mysqlUser,
    sqliteUser,
} from "../src/schema";

// The Drizzle auth schema is the contract between auth-kit and any database
// adapter. These tests pin the table set so a renamed/dropped table is caught.
const EXPECTED_TABLES = ["user", "session", "account", "verification"] as const;

describe("auth schema", () => {
    it("exports a postgres schema with all four auth tables", () => {
        expect(Object.keys(pgSchema).sort()).toEqual([...EXPECTED_TABLES].sort());
    });

    it("exports a mysql schema with all four auth tables", () => {
        expect(Object.keys(mysqlSchema).sort()).toEqual([...EXPECTED_TABLES].sort());
    });

    it("exports a sqlite schema with all four auth tables", () => {
        expect(Object.keys(sqliteSchema).sort()).toEqual([...EXPECTED_TABLES].sort());
    });

    it("exposes the individual user tables for each dialect", () => {
        expect(pgUser).toBeDefined();
        expect(mysqlUser).toBeDefined();
        expect(sqliteUser).toBeDefined();
    });

    it("wires the schema dictionaries to the same table objects", () => {
        expect(pgSchema.user).toBe(pgUser);
        expect(mysqlSchema.user).toBe(mysqlUser);
        expect(sqliteSchema.user).toBe(sqliteUser);
    });
});
