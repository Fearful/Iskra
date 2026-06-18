import { describe, it, expect, spyOn, afterEach } from "bun:test";
import { Hono } from "hono";
import { z } from "zod";
import { createValidationMiddleware } from "../../src/features/validation";

// createValidationMiddleware validates params/query/body with zod and returns a
// structured errorResponse on failure, attaching c.valid() with parsed data on
// success. Tests mount it on a bare Hono app and assert status + payload.

let errSpy: ReturnType<typeof spyOn> | null = null;
afterEach(() => {
    errSpy?.mockRestore();
    errSpy = null;
});

describe("createValidationMiddleware - body", () => {
    function makeApp() {
        const schema = { body: z.object({ name: z.string(), age: z.number() }) };
        const app = new Hono();
        app.post("/users", createValidationMiddleware(schema), (c) => {
            const validated = (c as any).valid();
            return c.json(validated);
        });
        return app;
    }

    it("passes valid JSON body through and exposes parsed data via c.valid()", async () => {
        const app = makeApp();
        const res = await app.request("/users", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "Ada", age: 36 }),
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ body: { name: "Ada", age: 36 } });
    });

    it("rejects an invalid body with a 400 VALIDATION_ERROR response", async () => {
        const app = makeApp();
        const res = await app.request("/users", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "Ada", age: "not-a-number" }),
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as any;
        expect(body.success).toBe(false);
        expect(body.code).toBe("VALIDATION_ERROR");
        expect(body.error).toBe("Invalid body");
        expect(body.details).toBeDefined();
    });

    it("treats a malformed/empty JSON body as {} and validates against it", async () => {
        const app = makeApp();
        const res = await app.request("/users", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "not json at all",
        });
        // {} fails the required-fields schema -> 400.
        expect(res.status).toBe(400);
    });
});

describe("createValidationMiddleware - query", () => {
    it("validates query params and passes when valid", async () => {
        const schema = { query: z.object({ page: z.string() }) };
        const app = new Hono();
        app.get("/list", createValidationMiddleware(schema), (c) =>
            c.json((c as any).valid()),
        );
        const ok = await app.request("/list?page=2");
        expect(ok.status).toBe(200);
        expect(await ok.json()).toEqual({ query: { page: "2" } });
    });

    it("rejects missing required query params", async () => {
        const schema = { query: z.object({ page: z.string() }) };
        const app = new Hono();
        app.get("/list", createValidationMiddleware(schema), (c) => c.json({}));
        const res = await app.request("/list");
        const body = (await res.json()) as any;
        expect(res.status).toBe(400);
        expect(body.error).toBe("Invalid query params");
    });
});

describe("createValidationMiddleware - params", () => {
    it("validates route params and rejects bad ones", async () => {
        const schema = { params: z.object({ id: z.string().regex(/^\d+$/) }) };
        const app = new Hono();
        app.get("/item/:id", createValidationMiddleware(schema), (c) =>
            c.json((c as any).valid()),
        );

        const ok = await app.request("/item/42");
        expect(ok.status).toBe(200);
        expect(await ok.json()).toEqual({ params: { id: "42" } });

        const bad = await app.request("/item/abc");
        const body = (await bad.json()) as any;
        expect(bad.status).toBe(400);
        expect(body.error).toBe("Invalid route params");
    });
});

describe("createValidationMiddleware - options", () => {
    it("honors a custom failure status code", async () => {
        const schema = { query: z.object({ q: z.string() }) };
        const app = new Hono();
        app.get("/s", createValidationMiddleware(schema, { status: 422 }), (c) => c.json({}));
        const res = await app.request("/s");
        expect(res.status).toBe(422);
    });

    it("parses a urlencoded body via parseBody", async () => {
        const schema = { body: z.object({ token: z.string() }) };
        const app = new Hono();
        app.post("/f", createValidationMiddleware(schema), (c) => c.json((c as any).valid()));
        const res = await app.request("/f", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: "token=xyz",
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ body: { token: "xyz" } });
    });
});
