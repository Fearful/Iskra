import { describe, expect, it } from "bun:test";
import { Kernel } from "../src/kernel";
import { EmailFeature, MockEmailAdapter, type EmailAdapter } from "../src/features/email";

describe("Email Feature", () => {
    it("should initialize with mock provider", async () => {
        const kernel = new Kernel();
        const email = new EmailFeature({ provider: "mock" });
        kernel.registerFeature(email);
        await kernel.initialize();

        const adapter = email.getAdapter();
        expect(adapter).toBeDefined();
        expect(adapter).toBeInstanceOf(MockEmailAdapter);

        await kernel.shutdown();
    });

    it("should send email via mock adapter", async () => {
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
        expect(result.messageId).toContain("mock-");

        await kernel.shutdown();
    });

    it("should send template email via mock adapter", async () => {
        const kernel = new Kernel();
        const email = new EmailFeature({ provider: "mock" });
        kernel.registerFeature(email);
        await kernel.initialize();

        const adapter = email.getAdapter();
        const result = await adapter.sendTemplate("welcome", "user@test.com", {
            name: "Juan",
        });

        expect(result.success).toBe(true);

        await kernel.shutdown();
    });

    it("should throw when accessing adapter before init", () => {
        const email = new EmailFeature({ provider: "mock" });
        try {
            email.getAdapter();
            expect(true).toBe(false);
        } catch (err) {
            expect((err as Error).message).toContain("not initialized");
        }
    });

    it("should support mailgun provider config without throwing on import", () => {
        // Verify the mailgun provider module exists and can be imported
        const email = new EmailFeature({
            provider: "mailgun",
            apiKey: "test-key",
            domain: "test.mailgun.org",
        });
        expect(email).toBeDefined();
    });
});
