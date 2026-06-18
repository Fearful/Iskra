import { Kernel } from "../src/kernel";
import { EmailFeature } from "../src/features/email";

// ============================================================================
// Example 1: Basic Email Sending (SMTP)
// ============================================================================

const basicKernel = new Kernel({ port: 8001 });

basicKernel.registerFeature(
    new EmailFeature({
        provider: "smtp",
        // @ts-ignore
        config: {
            host: "smtp.example.com",
            port: 587,
            username: "user",
            password: "password",
            from: { email: "noreply@example.com" },
        }
    }),
);
// In the new implementation config is directly passed to constructor, not nested in `config` property if that was the case?
// Checking EmailFeature implementation: constructor(config: EmailConfig)
// EmailConfig has { provider, smtp: { ... }, from: ... }
// So the structure above might need adjustment.
// Let's adjust to match new implementation.

/*
export interface EmailConfig {
  provider: "smtp" | "sendgrid" | "mock" | "mailgun" | "ses";
  smtp?: { ... };
  apiKey?: string;
  ...
}
*/

const correctedKernel = new Kernel({ port: 8001 });
correctedKernel.registerFeature(
    new EmailFeature({
        provider: "mock", // Use mock for example safety
        from: { email: "noreply@example.com", name: "Example" }
    })
);

correctedKernel.getApp().post("/send-email", async (c) => {
    // @ts-ignore
    const email = c.get("email");
    const body = await c.req.json();

    try {
        await email.send({
            to: body.to || "test@test.com",
            subject: body.subject || "Hello",
            text: body.message || "World",
        });

        return c.json({ message: "Email sent successfully" });
    } catch (error: any) {
        return c.json({ error: error.message }, 500);
    }
});


if (import.meta.main) {
    console.log("\n✅ Email Example (Mock) running on port 8001");
    await correctedKernel.start();
}
