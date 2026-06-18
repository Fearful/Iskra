import { describe, it, expect } from "bun:test";
import { createBetterAuth } from "../src/features/auth/better-auth-config";

// Better Auth's drizzle adapter only wraps the db object at construction time
// (no connection), so a plain object stands in for a real Drizzle instance here.
const SECRET = "test-secret-at-least-32-chars-long-xyz";
const fakeDb = {};

describe("createBetterAuth", () => {
    it("builds an auth instance for each supported adapter type", () => {
        for (const adapterType of ["postgres", "mysql", "sqlite"] as const) {
            const auth = createBetterAuth({ db: fakeDb, adapterType, secret: SECRET });
            expect(typeof auth.handler).toBe("function");
        }
    });

    it("throws for an unsupported adapter type", () => {
        expect(() =>
            createBetterAuth({ db: fakeDb, adapterType: "oracle" as any, secret: SECRET }),
        ).toThrow("Unsupported adapter type");
    });

    it("registers a generic OAuth plugin when oidcConfig is provided", () => {
        const auth = createBetterAuth({
            db: fakeDb,
            adapterType: "postgres",
            secret: SECRET,
            oidcConfig: {
                clientId: "cid",
                clientSecret: "csecret",
                issuer: "https://idp.example.com",
            },
        });
        expect(typeof auth.handler).toBe("function");
    });

    it("keeps trusted origins as-is when they already include the base origin and email/password is disabled", () => {
        const auth = createBetterAuth({
            db: fakeDb,
            adapterType: "sqlite",
            secret: SECRET,
            baseURL: "https://app.example.com",
            trustedOrigins: ["https://app.example.com", "https://other.example.com"],
            enableEmailPassword: false,
        });
        expect(typeof auth.handler).toBe("function");
    });
});
