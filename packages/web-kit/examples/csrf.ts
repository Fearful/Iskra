import { Kernel } from "../src/kernel";
import { CsrfFeature, requireCsrf } from "../src/features/csrf";
import { SessionFeature } from "../src/features/session";

// ============================================================================
// Example 1: Basic CSRF Protection
// ============================================================================

const basicKernel = new Kernel({ port: 8001 });

// CSRF protection with default settings
basicKernel.registerFeature(
    new CsrfFeature({
        secret: "your-csrf-secret-change-in-production",
    }),
);

// Initialize before adding routes: a route added earlier skips the features' middleware.
await basicKernel.initialize();

basicKernel.getApp().get("/form", (c) => {
    const csrfToken = c.get("csrfToken");

    return c.html(`
    <!DOCTYPE html>
    <html>
    <head><title>CSRF Example</title></head>
    <body>
      <h1>CSRF Protected Form</h1>
      <form method="POST" action="/submit">
        <input type="hidden" name="_csrf" value="${csrfToken}" />
        <input type="text" name="data" placeholder="Enter data" />
        <button type="submit">Submit</button>
      </form>
    </body>
    </html>
  `);
});

basicKernel.getApp().post("/submit", async (c) => {
    const body = await c.req.parseBody();
    return c.json({ message: "Form submitted successfully", data: body });
});

// ============================================================================
// Example 5: CSRF with Session
// ============================================================================

const sessionKernel = new Kernel({ port: 8005 });

// Session feature (CSRF can optionally use session storage)
sessionKernel.registerFeature(
    new SessionFeature({
        store: "memory",
        secret: "session-secret-0123456789abcdef0123456789abcdef",
    }),
);

sessionKernel.registerFeature(
    new CsrfFeature({
        secret: "csrf-secret",
    }),
);

// Initialize before adding routes: a route added earlier skips the features' middleware.
await sessionKernel.initialize();

sessionKernel.getApp().get("/login", (c) => {
    const csrfToken = c.get("csrfToken");

    return c.html(`
    <!DOCTYPE html>
    <html>
    <head><title>Login</title></head>
    <body>
      <h1>Login Form</h1>
      <form method="POST" action="/login">
        <input type="hidden" name="_csrf" value="${csrfToken}" />
        <input type="text" name="username" placeholder="Username" required />
        <input type="password" name="password" placeholder="Password" required />
        <button type="submit">Login</button>
      </form>
    </body>
    </html>
  `);
});

sessionKernel.getApp().post("/login", async (c) => {
    const body = await c.req.parseBody();

    // The session is a plain object: set fields, and it is saved after the response.
    const session = c.get("session");
    session.userId = "user123";
    session.username = String(body.username ?? "");

    return c.json({ message: "Logged in successfully" });
});

// Run
if (import.meta.main) {
    console.log("Starting Basic CSRF Example on port 8001...");
    await basicKernel.start();
    // To run other examples, uncomment or run separately.
    // await sessionKernel.start();
}
