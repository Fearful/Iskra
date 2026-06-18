import { describe, expect, it } from "bun:test";
import { Kernel } from "../src/kernel";
import { JsonSchemaValidationFeature, createJsonSchemaValidationMiddleware } from "../src/features/json-schema-validation";
import { ValidationFeature } from "../src/features/validation";
import { z } from "zod";

describe("JSON Schema Validation Feature", () => {
    async function createKernel() {
        const kernel = new Kernel();
        kernel.registerFeature(new JsonSchemaValidationFeature());
        await kernel.initialize();
        return kernel;
    }

    // ─── Basic Body Validation ──────────────────────────────────────────────

    it("should reject invalid body and return field errors", async () => {
        const kernel = await createKernel();
        const app = kernel.getApp();

        const schema = {
            type: "object",
            properties: {
                name: { type: "string" },
                age: { type: "integer", minimum: 0 },
            },
            required: ["name", "age"],
            additionalProperties: false,
        };

        const middleware = createJsonSchemaValidationMiddleware({ body: schema });
        app.post("/users", middleware, (c) => {
            const data = c.valid();
            return c.json({ success: true, data });
        });

        const res = await app.request("/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: 123 }),
        });

        expect(res.status).toBe(400);
        const json = await res.json() as any;
        expect(json.success).toBe(false);
        expect(json.code).toBe("VALIDATION_ERROR");
        expect(json.details.fields).toBeDefined();
        expect(json.details.errors.length).toBeGreaterThan(0);

        await kernel.shutdown();
    });

    it("should accept valid body", async () => {
        const kernel = await createKernel();
        const app = kernel.getApp();

        const schema = {
            type: "object",
            properties: {
                name: { type: "string" },
                age: { type: "integer", minimum: 0 },
            },
            required: ["name", "age"],
        };

        const middleware = createJsonSchemaValidationMiddleware({ body: schema });
        app.post("/users", middleware, (c) => {
            const data = c.valid();
            return c.json({ success: true, data });
        });

        const res = await app.request("/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Alice", age: 30 }),
        });

        expect(res.status).toBe(200);
        const json = await res.json() as any;
        expect(json.success).toBe(true);
        expect(json.data.body.name).toBe("Alice");

        await kernel.shutdown();
    });

    // ─── Custom errorMessage per Property ───────────────────────────────────

    it("should use custom errorMessage for property-level constraints", async () => {
        const kernel = await createKernel();
        const app = kernel.getApp();

        const schema = {
            type: "object",
            properties: {
                email: {
                    type: "string",
                    format: "email",
                    errorMessage: {
                        format: "Please provide a valid email address",
                        type: "Email must be a string",
                    },
                },
            },
            required: ["email"],
        };

        const middleware = createJsonSchemaValidationMiddleware({ body: schema });
        app.post("/register", middleware, (c) => c.json({ success: true }));

        const res = await app.request("/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: "not-an-email" }),
        });

        expect(res.status).toBe(400);
        const json = await res.json() as any;
        expect(json.details.fields.email).toContain("Please provide a valid email address");

        await kernel.shutdown();
    });

    // ─── Schema-level errorMessage ──────────────────────────────────────────

    it("should handle schema-level errorMessage string", async () => {
        const kernel = await createKernel();
        const app = kernel.getApp();

        const schema = {
            type: "object",
            properties: {
                name: { type: "string" },
            },
            required: ["name"],
            errorMessage: "The input data is invalid",
        };

        const middleware = createJsonSchemaValidationMiddleware({ body: schema });
        app.post("/check", middleware, (c) => c.json({ success: true }));

        const res = await app.request("/check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });

        expect(res.status).toBe(400);
        const json = await res.json() as any;
        expect(json.details.errors.some((e: string) => e.includes("The input data is invalid"))).toBe(true);

        await kernel.shutdown();
    });

    // ─── Required Field errorMessage ────────────────────────────────────────

    it("should use custom errorMessage for required fields", async () => {
        const kernel = await createKernel();
        const app = kernel.getApp();

        const schema = {
            type: "object",
            properties: {
                email: { type: "string" },
                age: { type: "integer" },
            },
            required: ["email", "age"],
            errorMessage: {
                required: {
                    email: "Email is required",
                    age: "Age is required",
                },
            },
        };

        const middleware = createJsonSchemaValidationMiddleware({ body: schema });
        app.post("/profile", middleware, (c) => c.json({ success: true }));

        const res = await app.request("/profile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });

        expect(res.status).toBe(400);
        const json = await res.json() as any;
        const allErrors = json.details.errors.join(" ");
        expect(allErrors).toContain("Email is required");
        expect(allErrors).toContain("Age is required");

        await kernel.shutdown();
    });

    // ─── Query Validation ───────────────────────────────────────────────────

    it("should validate query parameters", async () => {
        const kernel = await createKernel();
        const app = kernel.getApp();

        const schema = {
            type: "object",
            properties: {
                page: { type: "integer", minimum: 1 },
                limit: { type: "integer", minimum: 1, maximum: 100 },
            },
            required: ["page"],
        };

        const middleware = createJsonSchemaValidationMiddleware({ query: schema });
        app.get("/items", middleware, (c) => {
            const data = c.valid();
            return c.json({ success: true, data });
        });

        // Invalid: missing required page
        const res = await app.request("/items?limit=10");
        expect(res.status).toBe(400);
        const json = await res.json() as any;
        expect(json.code).toBe("VALIDATION_ERROR");

        // Valid
        const res2 = await app.request("/items?page=1&limit=10");
        expect(res2.status).toBe(200);

        await kernel.shutdown();
    });

    // ─── Params Validation ──────────────────────────────────────────────────

    it("should validate route parameters", async () => {
        const kernel = await createKernel();
        const app = kernel.getApp();

        const schema = {
            type: "object",
            properties: {
                id: { type: "integer", minimum: 1 },
            },
            required: ["id"],
        };

        const middleware = createJsonSchemaValidationMiddleware({ params: schema });
        app.get("/users/:id", middleware, (c) => {
            const data = c.valid();
            return c.json({ success: true, data });
        });

        // With coerceTypes=true (default), string "5" → integer 5
        const res = await app.request("/users/5");
        expect(res.status).toBe(200);
        const json = await res.json() as any;
        expect(json.data.params.id).toBe(5);

        await kernel.shutdown();
    });

    // ─── Coexistence with Zod Validation ────────────────────────────────────

    it("should coexist with Zod validation feature", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new ValidationFeature());
        kernel.registerFeature(new JsonSchemaValidationFeature());
        await kernel.initialize();

        const app = kernel.getApp();

        // JSON Schema route
        const jsonSchema = {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
        };
        const jsonMiddleware = createJsonSchemaValidationMiddleware({ body: jsonSchema });
        app.post("/json-route", jsonMiddleware, (c) => c.json({ source: "json-schema" }));

        // Zod route (using the *Validated method from ValidationFeature)
        // @ts-expect-error - postValidated is augmented by ValidationFeature at runtime
        app.postValidated("/zod-route", {
            body: z.object({ name: z.string() }),
        }, (c: any) => c.json({ source: "zod" }));

        // Test JSON Schema route
        const res1 = await app.request("/json-route", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Alice" }),
        });
        expect(res1.status).toBe(200);
        expect((await res1.json() as any).source).toBe("json-schema");

        // Test Zod route
        const res2 = await app.request("/zod-route", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Bob" }),
        });
        expect(res2.status).toBe(200);
        expect((await res2.json() as any).source).toBe("zod");

        await kernel.shutdown();
    });

    // ─── coerceTypes Behavior ───────────────────────────────────────────────

    it("should coerce types by default", async () => {
        const kernel = await createKernel();
        const app = kernel.getApp();

        const schema = {
            type: "object",
            properties: {
                age: { type: "integer" },
                active: { type: "boolean" },
            },
            required: ["age", "active"],
        };

        const middleware = createJsonSchemaValidationMiddleware({ body: schema });
        app.post("/coerce", middleware, (c) => {
            const data = c.valid();
            return c.json({ success: true, data });
        });

        const res = await app.request("/coerce", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ age: "25", active: "true" }),
        });

        expect(res.status).toBe(200);
        const json = await res.json() as any;
        expect(json.data.body.age).toBe(25);
        expect(json.data.body.active).toBe(true);

        await kernel.shutdown();
    });

    it("should respect coerceTypes=false option", async () => {
        const kernel = await createKernel();
        const app = kernel.getApp();

        const schema = {
            type: "object",
            properties: {
                age: { type: "integer" },
            },
            required: ["age"],
        };

        const middleware = createJsonSchemaValidationMiddleware({ body: schema }, { coerceTypes: false });
        app.post("/strict", middleware, (c) => c.json({ success: true }));

        const res = await app.request("/strict", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ age: "25" }),
        });

        expect(res.status).toBe(400);

        await kernel.shutdown();
    });
});
