import { describe, it, expect, afterEach } from "bun:test";

// RED test for the MEDIUM "CSRF kill switch" finding
// (src/types.ts:172 -> auth/index.ts:92 -> better-auth disableCSRFCheck).
//
// `disableCSRFCheck` has no environment guard, so a config that ships with the
// flag enabled silently disables CSRF protection in production. The fix must
// ignore the flag unless NODE_ENV !== "production" — i.e. in a production env
// the flag passed to createBetterAuth must be false regardless of config.
//
// We intercept createBetterAuth (the only place the flag is consumed) to capture
// the options the AuthFeature actually forwards.

import { AuthFeature } from "../src/features/auth/index";
import { Kernel } from "../src/kernel";

const captured: { disableCSRFCheck?: boolean }[] = [];

// A fake createBetterAuth injected through AuthFeature's constructor seam. We do
// NOT use bun's `mock.module` here: it is process-global and irreversible, so a
// module-level mock would leak into auth-kit's own security/integration suites
// and disable the real validation under test there.
const fakeCreateAuth = ((options: any) => {
    captured.push({ disableCSRFCheck: options.disableCSRFCheck });
    // Minimal fake Auth instance — initialize() only registers middleware
    // and stores the handle; it never calls into it during construction.
    return {
        handler: async () => new Response("ok"),
        api: { getSession: async () => null },
    };
}) as any;

// A DbFeature stand-in: AuthFeature reads `.db` and `.adapter` off it.
class FakeDbFeature {
    name = "db";
    db = {} as any;
    adapter = "sqlite" as const;
    async initialize() {}
}

const VALID_SECRET = "x".repeat(40); // satisfies auth-kit's >=32 char requirement

describe("AuthFeature — CSRF kill-switch production guard", () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        process.env.NODE_ENV = originalEnv;
        captured.length = 0;
    });

    it("ignores disableCSRFCheck in production (forwards false)", async () => {
        process.env.NODE_ENV = "production";

        const kernel = new Kernel();
        kernel.registerFeature(new FakeDbFeature() as any);
        kernel.registerFeature(
            new AuthFeature({ secret: VALID_SECRET, disableCSRFCheck: true } as any, fakeCreateAuth),
        );
        await kernel.initialize();

        expect(captured.length).toBeGreaterThan(0);
        // In production the flag must be neutralized regardless of config input.
        expect(captured[captured.length - 1].disableCSRFCheck).toBe(false);

        await kernel.shutdown();
    });

    it("honors disableCSRFCheck outside production", async () => {
        process.env.NODE_ENV = "development";

        const kernel = new Kernel();
        kernel.registerFeature(new FakeDbFeature() as any);
        kernel.registerFeature(
            new AuthFeature({ secret: VALID_SECRET, disableCSRFCheck: true } as any, fakeCreateAuth),
        );
        await kernel.initialize();

        expect(captured[captured.length - 1].disableCSRFCheck).toBe(true);

        await kernel.shutdown();
    });
});
