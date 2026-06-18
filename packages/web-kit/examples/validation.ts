import { Kernel } from "../src/kernel";
import { ValidationFeature } from "../src/features/validation";
import { z } from "zod";

// ============================================================================
// Example 1: Basic Request Validation
// ============================================================================

const basicKernel = new Kernel({ port: 8001 });

basicKernel.registerFeature(new ValidationFeature());

const userSchema = z.object({
    name: z.string().min(2).max(50),
    email: z.string().email(),
    age: z.number().int().positive().max(150),
});

// Initialize kernel to ensure ValidationFeature patches the app
await basicKernel.initialize();

// @ts-ignore - Assuming module augmentation works or strict types might complain about *Validated methods if not fully set up in types.ts
basicKernel.getApp().postValidated("/users", {
    body: userSchema
}, async (c) => {
    // Validated body is automatically available or passed?
    // In ValidationFeature implementation, we had *Validated(path, schema, handler)
    // The handler receives `c` and can valid input via `c.req.valid('json')` if using Hono Validator under hood,
    // OR the feature implementation might pass it differently.
    // Looking at ValidationFeature:
    // app.postValidated = function(path, schemas, handler) { ... }
    // It uses standard Hono validator.

    const body = c.req.valid("json");

    return c.json({
        message: "User created",
        user: body,
    }, 201);
});

if (import.meta.main) {
    console.log("Starting Basic Validation Example on port 8001...");
    await basicKernel.start();
}
