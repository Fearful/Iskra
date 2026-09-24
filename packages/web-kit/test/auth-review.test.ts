import { describe, it, expect, afterEach } from "bun:test";
import { AuthFeature } from "../src/features/auth/index";
import { DbFeature } from "../src/features/db";
import { Kernel } from "../src/kernel";
import { join } from "node:path";

// Real better-auth on in-memory sqlite, in production mode (where its own rate
// limiter is on and cookies depend on baseURL).

const DDL = `
CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, email TEXT NOT NULL UNIQUE, emailVerified INTEGER NOT NULL, image TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE TABLE session (id TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, ipAddress TEXT, userAgent TEXT, userId TEXT NOT NULL REFERENCES user(id));
CREATE TABLE account (id TEXT PRIMARY KEY, accountId TEXT NOT NULL, providerId TEXT NOT NULL, userId TEXT NOT NULL REFERENCES user(id), accessToken TEXT, refreshToken TEXT, idToken TEXT, accessTokenExpiresAt INTEGER, refreshTokenExpiresAt INTEGER, scope TEXT, password TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE TABLE verification (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expiresAt INTEGER NOT NULL, createdAt INTEGER, updatedAt INTEGER);
`;
const SECRET = "a-contract-secret-with-enough-entropy-1f9c2e7b";
const ORIGIN = "https://app.example.com";

const saved = { NODE_ENV: process.env.NODE_ENV, BETTER_AUTH_URL: process.env.BETTER_AUTH_URL };
afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

async function productionKernel(authConfig: Record<string, unknown> = {}) {
    process.env.NODE_ENV = "production";
    const kernel = new Kernel();
    const db = new DbFeature({ adapter: "sqlite", connection: { database: ":memory:" } });
    kernel.registerFeature(db);
    kernel.registerFeature(new AuthFeature({ secret: SECRET, basePath: "/api/sso", trustedOrigins: [ORIGIN], ...authConfig } as any));
    await kernel.initialize();
    (db.db as unknown as { $client: { exec(sql: string): void } }).$client.exec(DDL);
    return kernel.getApp();
}

/** A request from `address`, as Bun.serve passes it (no proxy headers). */
function from(address: string) {
    return { requestIP: () => ({ address, family: "IPv4", port: 40000 }) };
}

describe("AuthFeature in production", () => {
    it("rate-limits sign-in per client, not with one bucket shared by every client", () => {
        const child = Bun.spawnSync([process.execPath, join(import.meta.dir, "fixtures/auth-production.ts")], {
            env: { ...process.env, NODE_ENV: "production" },
            stdout: "pipe",
            stderr: "pipe",
        });
        const line = child.stdout.toString().split("\n").find((l) => l.startsWith("RESULT "));
        expect(line).toBeDefined();
        const { first, other, spoofed } = JSON.parse(line!.slice("RESULT ".length));
        // better-auth could not see the socket address and put every client
        // without X-Forwarded-For in one bucket: after 3 attempts by anyone,
        // nobody could sign in.
        expect(first).toEqual([401, 401, 401, 429]);
        expect(other).toBe(401);
        // A client-sent x-iskra-client-ip is replaced, not trusted.
        expect(spoofed).toEqual([401, 401, 401, 429]);
    }, 30000);

    it("requires a baseURL, and takes BETTER_AUTH_URL, so cookies are Secure", async () => {
        process.env.NODE_ENV = "production";
        delete process.env.BETTER_AUTH_URL;
        expect(() => new AuthFeature({ secret: SECRET, basePath: "/api/sso" } as any)).toThrow(/baseURL/);

        process.env.BETTER_AUTH_URL = ORIGIN;
        const app = await productionKernel();
        const res = await app.request(
            "/api/sso/sign-up/email",
            {
                method: "POST",
                headers: { "content-type": "application/json", origin: ORIGIN },
                body: JSON.stringify({ email: "new@example.com", password: "password1234", name: "New" }),
            },
            from("198.51.100.4"),
        );
        expect(res.status).toBe(200);
        const cookie = res.headers.get("set-cookie") ?? "";
        // It defaulted to http://localhost:3000: no Secure flag in production.
        expect(cookie).toContain("__Secure-");
        expect(cookie).toContain("Secure");
    });
});
