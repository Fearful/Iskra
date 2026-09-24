import { describe, it, expect } from "bun:test";
import { AuthFeature } from "../src/features/auth/index";
import { Kernel } from "../src/kernel";

class FakeDbFeature {
    name = "db";
    db = {} as any;
    adapter = "sqlite" as const;
    async initialize() {}
}

const SECRET = "x".repeat(40);
const oidcConfig = { clientId: "id", clientSecret: "secret", issuer: "https://idp.example.com" };

/** Initializes an AuthFeature and returns the options it passed to createBetterAuth. */
async function optionsFor(config: Record<string, unknown>) {
    let captured: any;
    const fakeCreateAuth = ((opts: any) => {
        captured = opts;
        return { handler: async () => new Response("ok"), api: { getSession: async () => null } };
    }) as any;
    const kernel = new Kernel();
    kernel.registerFeature(new FakeDbFeature() as any);
    kernel.registerFeature(new AuthFeature({ secret: SECRET, ...config } as any, fakeCreateAuth));
    await kernel.initialize();
    return captured;
}

describe("AuthFeature authMode / enableSelfRegistration", () => {
    it("email mode enables email/password with open sign-up by default", async () => {
        const opts = await optionsFor({});
        expect(opts.enableEmailPassword).toBe(true);
        expect(opts.disableSignUp).toBe(false);
    });

    it("OIDC mode does not also expose email/password login", async () => {
        // Regression: enableEmailPassword was hardcoded to true, so an OIDC-only
        // deployment still exposed an open /sign-up/email.
        expect((await optionsFor({ authMode: "oidc", oidcConfig })).enableEmailPassword).toBe(false);
        expect((await optionsFor({ oidcConfig })).enableEmailPassword).toBe(false);
    });

    it("enableEmailPassword can opt back in alongside OIDC", async () => {
        expect((await optionsFor({ oidcConfig, enableEmailPassword: true })).enableEmailPassword).toBe(true);
    });

    it("enableSelfRegistration: false disables sign-up", async () => {
        expect((await optionsFor({ enableSelfRegistration: false })).disableSignUp).toBe(true);
    });
});
