import { describe, expect, it } from "bun:test";
import { createEmailAdapter } from "../src/factory";
import { MockEmailAdapter } from "../src/mock";
import { SmtpEmailAdapter } from "../src/providers/smtp";
import { SendGridEmailAdapter } from "../src/providers/sendgrid";
import { MailgunEmailAdapter } from "../src/providers/mailgun";
import { SesEmailAdapter } from "../src/providers/ses";

describe("createEmailAdapter", () => {
    it("returns a MockEmailAdapter for provider 'mock'", async () => {
        const adapter = await createEmailAdapter({ provider: "mock" });
        expect(adapter).toBeInstanceOf(MockEmailAdapter);
    });

    it("returns a SmtpEmailAdapter for provider 'smtp'", async () => {
        const adapter = await createEmailAdapter({
            provider: "smtp",
            smtp: { host: "localhost", port: 587, username: "u", password: "p" },
        });
        expect(adapter).toBeInstanceOf(SmtpEmailAdapter);
    });

    it("returns a SendGridEmailAdapter for provider 'sendgrid'", async () => {
        const adapter = await createEmailAdapter({ provider: "sendgrid", apiKey: "SG.test" });
        expect(adapter).toBeInstanceOf(SendGridEmailAdapter);
    });

    it("returns a MailgunEmailAdapter for provider 'mailgun'", async () => {
        const adapter = await createEmailAdapter({
            provider: "mailgun",
            apiKey: "key-12345",
            domain: "test.mailgun.org",
        });
        expect(adapter).toBeInstanceOf(MailgunEmailAdapter);
    });

    it("returns a SesEmailAdapter for provider 'ses' (no longer throws 'not implemented')", async () => {
        const adapter = await createEmailAdapter({ provider: "ses", region: "us-east-1", from: { email: "no-reply@test.com" } });
        expect(adapter).toBeInstanceOf(SesEmailAdapter);
    });

    it("throws for an unknown provider", async () => {
        await expect(createEmailAdapter({ provider: "carrier-pigeon" as any }))
            .rejects.toThrow("Provider carrier-pigeon not implemented");
    });
});
