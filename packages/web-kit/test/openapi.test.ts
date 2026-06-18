import { describe, it, expect } from "bun:test";
import { Kernel } from "../src/kernel";
import { OpenAPIFeature, createRoute, z } from "../src/features/openapi";

describe("OpenAPI Feature", () => {
    it("serves the OpenAPI document with configured info and a route queued before init", async () => {
        const kernel = new Kernel();
        const openapi = new OpenAPIFeature({ title: "Test API", version: "1.2.3", description: "desc" });

        // Added before initialize() → exercises the queued-route path.
        openapi.addRoute(
            createRoute({
                method: "get",
                path: "/ping",
                tags: ["health"],
                summary: "Ping",
                responses: { 200: { description: "pong" } },
            }),
            ((c: any) => c.json({ pong: true })) as any,
        );

        kernel.registerFeature(openapi);
        await kernel.initialize();
        const app = kernel.getApp();

        const res = await app.request("/openapi.json");
        expect(res.status).toBe(200);
        const spec = (await res.json()) as any;
        expect(spec.info.title).toBe("Test API");
        expect(spec.info.version).toBe("1.2.3");
        expect(spec.paths["/ping"]).toBeDefined();

        const ping = await app.request("/ping");
        expect(await ping.json()).toEqual({ pong: true });

        await kernel.shutdown();
    });

    it("serves the Scalar docs HTML", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new OpenAPIFeature({ title: "Docs API", version: "1.0.0" }));
        await kernel.initialize();

        const res = await kernel.getApp().request("/docs");
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("Docs API");
        expect(html).toContain("api-reference");

        await kernel.shutdown();
    });

    it("attaches configured security schemes to the document", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(
            new OpenAPIFeature({
                title: "Secure API",
                version: "1.0.0",
                securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
            }),
        );
        await kernel.initialize();

        const spec = (await (await kernel.getApp().request("/openapi.json")).json()) as any;
        expect(spec.components.securitySchemes.bearerAuth).toEqual({ type: "http", scheme: "bearer" });

        await kernel.shutdown();
    });

    it("returns a validation error through the default hook on bad input", async () => {
        const kernel = new Kernel();
        const openapi = new OpenAPIFeature({ title: "Validated API", version: "1.0.0" });

        openapi.addRoute(
            createRoute({
                method: "post",
                path: "/users",
                request: {
                    body: {
                        content: {
                            "application/json": {
                                schema: z.object({ email: z.string().email() }),
                            },
                        },
                    },
                },
                responses: { 200: { description: "ok" } },
            }),
            ((c: any) => c.json({ ok: true })) as any,
        );

        kernel.registerFeature(openapi);
        await kernel.initialize();

        const res = await kernel.getApp().request("/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: "not-an-email" }),
        });

        expect(res.status).toBe(400);
        const json = (await res.json()) as any;
        expect(json.success).toBe(false);
        expect(json.code).toBe("VALIDATION_ERROR");

        await kernel.shutdown();
    });
});
