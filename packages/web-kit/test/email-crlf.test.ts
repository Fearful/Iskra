import { describe, it, expect } from "bun:test";
import { Kernel } from "../src/kernel";
import { EmailFeature } from "../src/features/email";

// RED test for the LOW "email CRLF" finding (src/features/email/index.ts).
//
// The EmailFeature wrapper adds no recipient/header validation, so an attacker
// who controls a recipient address can inject CRLF sequences to smuggle extra
// SMTP headers (header injection). The fix must add central recipient +
// header-name/CRLF validation before app code reaches the adapter, rejecting
// addresses or headers that contain CR/LF.

const CRLF_RECIPIENT = "victim@example.com\r\nBcc: attacker@evil.com";

describe("EmailFeature — recipient/header CRLF validation", () => {
    it("rejects a recipient address containing CRLF", async () => {
        const kernel = new Kernel();
        const email = new EmailFeature({ provider: "mock" });
        kernel.registerFeature(email);
        await kernel.initialize();

        const adapter = email.getAdapter();

        let threw = false;
        try {
            await adapter.send({
                to: CRLF_RECIPIENT,
                subject: "Test",
                text: "Hello",
            });
        } catch {
            threw = true;
        }

        // A CRLF-bearing recipient must be rejected (thrown) rather than silently
        // forwarded to the underlying adapter.
        expect(threw).toBe(true);

        await kernel.shutdown();
    });

    it("rejects a subject header containing CRLF", async () => {
        const kernel = new Kernel();
        const email = new EmailFeature({ provider: "mock" });
        kernel.registerFeature(email);
        await kernel.initialize();

        const adapter = email.getAdapter();

        let threw = false;
        try {
            await adapter.send({
                to: "user@example.com",
                subject: "Hello\r\nBcc: attacker@evil.com",
                text: "Hi",
            });
        } catch {
            threw = true;
        }

        expect(threw).toBe(true);

        await kernel.shutdown();
    });

    it("still sends to a clean recipient", async () => {
        const kernel = new Kernel();
        const email = new EmailFeature({ provider: "mock" });
        kernel.registerFeature(email);
        await kernel.initialize();

        const adapter = email.getAdapter();
        const result = await adapter.send({
            to: "user@example.com",
            subject: "Test",
            text: "Hello",
        });
        expect(result.success).toBe(true);

        await kernel.shutdown();
    });
});
