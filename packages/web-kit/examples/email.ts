import { Kernel } from "../src/kernel";
import { EmailFeature } from "../src/features/email";

// ============================================================================
// Example 1: Basic Email Sending (SMTP)
// ============================================================================

const basicKernel = new Kernel({ port: 8001 });

basicKernel.registerFeature(
    new EmailFeature({
        provider: "smtp",
        smtp: {
            host: "smtp.example.com",
            port: 587,
            username: "user",
            password: "password",
        },
        from: { email: "noreply@example.com" },
    }),
);

// ============================================================================
// Example 2: The mock provider (nothing is sent), and sending from a route
// ============================================================================

const correctedKernel = new Kernel({ port: 8001 });
correctedKernel.registerFeature(
    new EmailFeature({
        provider: "mock", // Use mock for example safety
        from: { email: "noreply@example.com", name: "Example" }
    })
);

correctedKernel.getApp().post("/send-email", async (c) => {
    const email = c.get("email");
    const body = await c.req.json();

    try {
        await email.send({
            to: body.to || "test@test.com",
            subject: body.subject || "Hello",
            text: body.message || "World",
        });

        return c.json({ message: "Email sent successfully" });
    } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
});


if (import.meta.main) {
    console.log("\n✅ Email Example (Mock) running on port 8001");
    await correctedKernel.start();
}
