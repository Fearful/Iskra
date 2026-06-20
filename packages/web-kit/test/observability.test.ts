import { describe, expect, it } from "bun:test";
import { Kernel } from "../src/kernel";
import { OtelTracingFeature } from "../src/features/tracing";
import { EmailFeature } from "../src/features/email";

describe("Observability Features", () => {
    it("should initialize tracing", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new OtelTracingFeature({
            serviceName: "test-service",
            captureRequestHeaders: ["user-agent"]
        }));
        await kernel.initialize();

        const app = kernel.getApp();
        // Just checking it doesn't crash on request
        const res = await app.request("/");
        expect(res.status).toBe(404); // Default 404
    });

    it("should initialize email and send mock", async () => {
        const kernel = new Kernel();
        const emailFeature = new EmailFeature({ provider: "mock" });
        kernel.registerFeature(emailFeature);
        await kernel.initialize();

        const app = kernel.getApp();
        // getAdapter returns a validating wrapper exposing the EmailAdapter contract.
        const adapter = emailFeature.getAdapter();
        expect(typeof adapter.send).toBe("function");

        const res = await adapter.send({
            to: "test@example.com",
            subject: "Test",
            text: "Hello"
        });
        expect(res.success).toBe(true);
        expect(res.messageId).toStartWith("mock-");
    });
});
