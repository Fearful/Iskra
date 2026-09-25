import { Kernel } from "../src/kernel";
import { validate } from "../src/features/validation";
import { z } from "zod";

// ============================================================================
// Example: request validation with Zod
// ============================================================================
// validate() is a plain Hono middleware: no feature to register. The handler
// reads the parsed data from c.get("validated"), typed from the schemas.

const kernel = new Kernel({ port: 8001 });
await kernel.initialize();
const app = kernel.getApp();

const userSchema = z.object({
    name: z.string().min(2).max(50),
    email: z.string().email(),
    age: z.number().int().positive().max(150),
});

app.post("/users", validate({ body: userSchema }), (c) => {
    const user = c.get("validated").body; // { name: string; email: string; age: number }
    return c.json({ message: "User created", user }, 201);
});

app.get(
    "/users/:id",
    validate({
        params: z.object({ id: z.string().uuid() }),
        query: z.object({ fields: z.string().optional() }),
    }),
    (c) => {
        const { params, query } = c.get("validated");
        return c.json({ id: params.id, fields: query.fields ?? "all" });
    },
);

if (import.meta.main) {
    console.log("Starting Validation Example on port 8001...");
    await kernel.start();
}
