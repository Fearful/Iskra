import { describe, expect, it, afterEach, spyOn } from "bun:test";
import * as nodemailer from "nodemailer";
import { SmtpEmailAdapter } from "../src/providers/smtp";
import { SesEmailAdapter, type SesClient, type SesCommand } from "../src/providers/ses";
import { MailgunEmailAdapter } from "../src/providers/mailgun";
import { SendGridEmailAdapter } from "../src/providers/sendgrid";

/**
 * RED — Finding: MEDIUM sendTemplate stubs.
 *
 * Every provider's `sendTemplate` currently ignores the template engine and
 * sends a placeholder subject `Template: <name>` with `JSON.stringify(data)`
 * as the body, yet returns `{ success: true }` — a silent broken send.
 *
 * Desired fixed behavior: `sendTemplate` must NOT silently succeed. It must
 * throw `Error("sendTemplate not supported by <provider>")` until a real
 * template engine is implemented (or the method removed from the interface).
 *
 * These tests assert the throw. They FAIL today because the stubs resolve
 * successfully (and, for Mailgun, hit fetch instead of throwing).
 */
describe("sendTemplate stubs must not silently succeed", () => {
    it("SMTP sendTemplate throws 'not supported by smtp' instead of sending a placeholder", async () => {
        const sendMail = spyOn({ sendMail: async () => ({ messageId: "smtp-id" }) }, "sendMail");
        const createSpy = spyOn(nodemailer, "createTransport").mockReturnValue({ sendMail } as any);
        try {
            const adapter = new SmtpEmailAdapter({
                provider: "smtp",
                smtp: { host: "localhost", port: 587, username: "u", password: "p" },
                from: { email: "no-reply@iskra.dev" },
            });

            await expect(adapter.sendTemplate("welcome", "user@example.com", { name: "Ada" }))
                .rejects.toThrow("sendTemplate not supported by smtp");
            // A real send must never have been attempted.
            expect(sendMail).not.toHaveBeenCalled();
        } finally {
            createSpy.mockRestore();
        }
    });

    it("SES sendTemplate throws 'not supported by ses' instead of delegating to send()", async () => {
        const sent: SesCommand[] = [];
        const client: SesClient = {
            async send(command) {
                sent.push(command);
                return { MessageId: "ses-id" };
            },
        };
        const sendEmailCommand = (input: unknown): SesCommand => ({ input });
        const adapter = new SesEmailAdapter(
            { provider: "ses", from: { email: "no-reply@iskra.dev" } },
            { client, sendEmailCommand },
        );

        await expect(adapter.sendTemplate("welcome", "user@example.com", { name: "Ada" }))
            .rejects.toThrow("sendTemplate not supported by ses");
        expect(sent).toHaveLength(0);
    });

    it("SendGrid sendTemplate throws 'not supported by sendgrid' instead of sending a placeholder", async () => {
        const adapter = new SendGridEmailAdapter({
            provider: "sendgrid",
            apiKey: "SG.test",
            from: { email: "no-reply@iskra.dev" },
        });

        await expect(adapter.sendTemplate("welcome", "user@example.com", { name: "Ada" }))
            .rejects.toThrow("sendTemplate not supported by sendgrid");
    });
});

describe("Mailgun sendTemplate stub must not silently succeed", () => {
    let fetchSpy: ReturnType<typeof spyOn> | null = null;

    afterEach(() => {
        fetchSpy?.mockRestore();
        fetchSpy = null;
    });

    it("Mailgun sendTemplate throws 'not supported by mailgun' instead of posting a placeholder", async () => {
        // If the stub is fixed to throw, fetch must never be called.
        fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ id: "<tpl>", message: "Queued" }), { status: 200 }),
        ) as any;

        const adapter = new MailgunEmailAdapter({
            provider: "mailgun",
            apiKey: "key-12345",
            domain: "test.mailgun.org",
            from: { email: "no-reply@iskra.dev" },
        });

        await expect(adapter.sendTemplate("welcome", "user@example.com", { name: "Ada" }))
            .rejects.toThrow("sendTemplate not supported by mailgun");
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
