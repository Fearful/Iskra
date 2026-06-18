import { describe, expect, it, afterEach, spyOn } from "bun:test";
import { Kernel } from "../src/kernel";
import { EmailFeature, MockEmailAdapter, type EmailAdapter } from "../src/features/email";
import { MailgunEmailAdapter } from "../src/features/email/providers/mailgun";

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

    it("should throw for unsupported provider", async () => {
        const kernel = new Kernel();
        const email = new EmailFeature({ provider: "ses" as any });
        kernel.registerFeature(email);

        try {
            await kernel.initialize();
            expect(true).toBe(false);
        } catch (err) {
            expect((err as Error).message).toContain("not implemented");
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

    describe("MailgunEmailAdapter", () => {
        it("should instantiate with required config", async () => {
            const { MailgunEmailAdapter } = await import("../src/features/email/providers/mailgun");
            const adapter = new MailgunEmailAdapter({
                provider: "mailgun",
                apiKey: "key-12345",
                domain: "test.mailgun.org",
                from: { email: "noreply@test.com", name: "Test" },
            });
            expect(adapter).toBeDefined();
        });

        it("should throw without apiKey", async () => {
            const { MailgunEmailAdapter } = await import("../src/features/email/providers/mailgun");
            try {
                new MailgunEmailAdapter({ provider: "mailgun" } as any);
                expect(true).toBe(false);
            } catch (err) {
                expect((err as Error).message).toContain("apiKey");
            }
        });

        it("should throw without domain", async () => {
            const { MailgunEmailAdapter } = await import("../src/features/email/providers/mailgun");
            try {
                new MailgunEmailAdapter({ provider: "mailgun", apiKey: "key" } as any);
                expect(true).toBe(false);
            } catch (err) {
                expect((err as Error).message).toContain("domain");
            }
        });
    });

    describe("MailgunEmailAdapter send/sendTemplate (fetch mocked)", () => {
        let fetchSpy: ReturnType<typeof spyOn> | null = null;

        afterEach(() => {
            fetchSpy?.mockRestore();
            fetchSpy = null;
        });

        function mockFetch(response: Response) {
            fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(response) as any;
        }

        const makeAdapter = () =>
            new MailgunEmailAdapter({
                provider: "mailgun",
                apiKey: "key-12345",
                domain: "test.mailgun.org",
                from: { email: "noreply@test.com", name: "Test Sender" },
            });

        it("posts to the Mailgun messages endpoint with auth and a fully built form", async () => {
            mockFetch(new Response(JSON.stringify({ id: "<msg-1>", message: "Queued" }), { status: 200 }));

            const result = await makeAdapter().send({
                to: ["a@example.com", "b@example.com"],
                subject: "Hello",
                text: "Body text",
                html: "<p>Body</p>",
                cc: "cc@example.com",
                bcc: ["bcc1@example.com", "bcc2@example.com"],
                replyTo: "reply@example.com",
                headers: { "X-Custom": "yes" },
                attachments: [
                    { filename: "a.txt", content: "hello", contentType: "text/plain" },
                    { filename: "b.bin", content: new TextEncoder().encode("bin") },
                ],
            });

            expect(result).toEqual({ messageId: "<msg-1>", success: true });

            const [url, init] = fetchSpy!.mock.calls[0] as [string, any];
            expect(url).toBe("https://api.mailgun.net/v3/test.mailgun.org/messages");
            expect(init.method).toBe("POST");
            expect(init.headers.Authorization).toBe("Basic " + btoa("api:key-12345"));

            const form = init.body as FormData;
            expect(form.get("to")).toBe("a@example.com,b@example.com");
            expect(form.get("from")).toBe("Test Sender <noreply@test.com>");
            expect(form.get("subject")).toBe("Hello");
            expect(form.get("text")).toBe("Body text");
            expect(form.get("html")).toBe("<p>Body</p>");
            expect(form.get("cc")).toBe("cc@example.com");
            expect(form.get("bcc")).toBe("bcc1@example.com,bcc2@example.com");
            expect(form.get("h:Reply-To")).toBe("reply@example.com");
            expect(form.get("h:X-Custom")).toBe("yes");
            expect(form.getAll("attachment")).toHaveLength(2);
            expect((form.get("attachment") as File).name).toBe("a.txt");
        });

        it("falls back to a bare email when 'from' has no name", async () => {
            mockFetch(new Response(JSON.stringify({ id: "<x>", message: "ok" }), { status: 200 }));

            const adapter = new MailgunEmailAdapter({
                provider: "mailgun",
                apiKey: "k",
                domain: "d.org",
                from: { email: "plain@test.com" },
            });
            await adapter.send({ to: "x@example.com", subject: "s", text: "t" });

            const [, init] = fetchSpy!.mock.calls[0] as [string, any];
            expect((init.body as FormData).get("from")).toBe("plain@test.com");
        });

        it("throws on a non-ok Mailgun response", async () => {
            mockFetch(new Response("Forbidden", { status: 401 }));
            await expect(makeAdapter().send({ to: "x@example.com", subject: "s", text: "t" }))
                .rejects.toThrow("Mailgun API error (401): Forbidden");
        });

        it("sends a template message with serialized variables", async () => {
            mockFetch(new Response(JSON.stringify({ id: "<tpl-1>", message: "Queued" }), { status: 200 }));

            const result = await makeAdapter().sendTemplate("welcome", "user@example.com", { name: "Ada" });
            expect(result).toEqual({ messageId: "<tpl-1>", success: true });

            const [, init] = fetchSpy!.mock.calls[0] as [string, any];
            const form = init.body as FormData;
            expect(form.get("template")).toBe("welcome");
            expect(form.get("to")).toBe("user@example.com");
            expect(JSON.parse(form.get("h:X-Mailgun-Variables") as string)).toEqual({ name: "Ada" });
            expect(form.get("from")).toBe("Test Sender <noreply@test.com>");
        });

        it("throws when a template send fails", async () => {
            mockFetch(new Response("Bad template", { status: 400 }));
            await expect(makeAdapter().sendTemplate("nope", ["user@example.com"], {}))
                .rejects.toThrow("Mailgun API error (400): Bad template");
        });

        it("honors a custom baseUrl", async () => {
            mockFetch(new Response(JSON.stringify({ id: "<x>", message: "ok" }), { status: 200 }));

            const adapter = new MailgunEmailAdapter({
                provider: "mailgun",
                apiKey: "k",
                domain: "d.org",
                baseUrl: "https://api.eu.mailgun.net/v3",
            });
            await adapter.send({ to: "x@example.com", subject: "s", text: "t" });

            const [url] = fetchSpy!.mock.calls[0] as [string, any];
            expect(url).toBe("https://api.eu.mailgun.net/v3/d.org/messages");
        });
    });
});
