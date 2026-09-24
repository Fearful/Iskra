import { describe, expect, it } from "bun:test";
import { Kernel } from "../src/kernel";
import { ValidationFeature } from "../src/features/validation";
import { OpenAPIFeature, z } from "../src/features/openapi";
import { UploadFeature } from "../src/features/upload";
import { StorageFeature } from "../src/features/storage";

describe("API Features", () => {
    it("should validation requests", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new ValidationFeature());
        await kernel.initialize();

        const app = kernel.getApp();
        // @ts-expect-error - postValidated is augmented by ValidationFeature at runtime
        app.postValidated("/test", {
            body: z.object({ name: z.string() })
        }, (c: { json: (o: unknown) => Response }) => c.json({ ok: true }));

        const res1 = await app.request("/test", {
            method: "POST",
            body: JSON.stringify({ name: 123 }),
            headers: { "Content-Type": "application/json" }
        });
        expect(res1.status).toBe(400);

        const res2 = await app.request("/test", {
            method: "POST",
            body: JSON.stringify({ name: "valid" }),
            headers: { "Content-Type": "application/json" }
        });
        expect(res2.status).toBe(200);
    });

    it("should generate openapi spec", async () => {
        const kernel = new Kernel();
        const openapi = new OpenAPIFeature({ title: "Test API", version: "1.0.0" });
        kernel.registerFeature(openapi);
        await kernel.initialize();

        const app = kernel.getApp();
        openapi.routes(app); // Manually mount routes if feature doesn't do it automatically or check implementation

        const res = await app.request("/openapi.json");
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.info.title).toBe("Test API");
    });

    it("should handle uploads", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new StorageFeature({ adapter: "local" }));
        kernel.registerFeature(new UploadFeature({
            projectName: "test-project",
            exposeRoutes: true,
            authorize: () => true
        }));
        await kernel.initialize();

        const app = kernel.getApp();
        const upload = kernel.getFeature("upload");
        expect(upload).toBeDefined();

        // Testing direct upload usage via helper
        // @ts-expect-error - helper is not on the public Feature type
        const helper = upload.helper;
        const res = await helper.upload("test.txt", "content");
        expect(res.path).toBe("test-project/test.txt");
    });
});
