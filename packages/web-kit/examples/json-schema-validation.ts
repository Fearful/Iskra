import { Kernel } from "../src/kernel";
import { JsonSchemaValidationFeature, createJsonSchemaValidationMiddleware } from "../src/features/json-schema-validation";

// ============================================================================
// Example: JSON Schema Validation with Custom Error Messages
// ============================================================================

const kernel = new Kernel({ port: 8002 });
kernel.registerFeature(new JsonSchemaValidationFeature());
await kernel.initialize();

const app = kernel.getApp();

// ── Schema with errorMessage keywords ───────────────────────────────────────
// This schema can be shared as a .json file between frontend and backend.

const createUserSchema = {
    type: "object",
    properties: {
        name: {
            type: "string",
            minLength: 2,
            maxLength: 50,
            errorMessage: {
                type: "Name must be a string",
                minLength: "Name must be at least 2 characters",
                maxLength: "Name must be at most 50 characters",
            },
        },
        email: {
            type: "string",
            format: "email",
            errorMessage: {
                type: "Email must be a string",
                format: "Please provide a valid email address",
            },
        },
        age: {
            type: "integer",
            minimum: 18,
            maximum: 150,
            errorMessage: {
                type: "Age must be a number",
                minimum: "You must be at least 18 years old",
                maximum: "Age must be 150 or less",
            },
        },
    },
    required: ["name", "email", "age"],
    errorMessage: {
        required: {
            name: "Name is required",
            email: "Email is required",
            age: "Age is required",
        },
    },
    additionalProperties: false,
};

// ── Using middleware directly ────────────────────────────────────────────────

const middleware = createJsonSchemaValidationMiddleware({ body: createUserSchema });

app.post("/users", middleware, (c) => {
    const { body } = c.valid();
    return c.json({
        success: true,
        message: "User created",
        data: body,
    }, 201);
});

// ── Using the *JsonValidated convenience method ─────────────────────────────

// @ts-ignore
app.postJsonValidated("/users-v2", { body: createUserSchema }, (c) => {
    const { body } = c.valid();
    return c.json({
        success: true,
        message: "User created (v2)",
        data: body,
    }, 201);
});

// ── Query parameter validation ──────────────────────────────────────────────

const listUsersQuerySchema = {
    type: "object",
    properties: {
        page: { type: "integer", minimum: 1 },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        sort: { type: "string", enum: ["name", "email", "age"] },
    },
    required: ["page"],
    errorMessage: {
        required: {
            page: "Page number is required",
        },
    },
};

const queryMiddleware = createJsonSchemaValidationMiddleware({ query: listUsersQuerySchema });

app.get("/users", queryMiddleware, (c) => {
    const { query } = c.valid();
    return c.json({
        success: true,
        data: [],
        pagination: query,
    });
});

if (import.meta.main) {
    console.log("Starting JSON Schema Validation Example on port 8002...");
    await kernel.start();
}
