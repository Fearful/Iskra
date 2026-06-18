import type { Feature, UploadConfig } from "../../types";
import type { Kernel } from "../../kernel";
import type { Hono, Context, Next } from "hono";
import { UploadHelper } from "./helper";
import type { StorageFeature } from "../storage";

declare module "hono" {
    interface ContextVariableMap {
        upload: UploadHelper;
    }
}

export class UploadFeature implements Feature {
    name = "upload";
    dependencies = ["storage"];
    private helper?: UploadHelper;
    private config: Required<UploadConfig>;

    constructor(config: UploadConfig) {
        this.config = {
            projectName: config.projectName,
            maxFileSize: config.maxFileSize || 10 * 1024 * 1024,
            allowedExtensions: config.allowedExtensions || [],
            exposeRoutes: config.exposeRoutes || false,
            routePrefix: config.routePrefix || "/upload"
        };
    }

    async initialize(kernel: Kernel): Promise<void> {
        const storageFeature = kernel.getFeature("storage") as unknown as StorageFeature;
        if (!storageFeature) throw new Error("Upload feature requires storage feature");
        const storage = storageFeature.getAdapter();
        if (!storage) throw new Error("Storage adapter not ready");

        this.helper = new UploadHelper(storage, this.config.projectName);

        const app = kernel.getApp();
        app.use("*", async (c: Context, next: Next) => {
            c.set("upload", this.helper!);
            await next();
        });

        console.log(`✅ Upload feature initialized: ${this.config.projectName}`);
    }

    routes(app: Hono) {
        if (!this.config.exposeRoutes) return;

        const prefix = this.config.routePrefix;

        // POST — upload a file
        app.post(`${prefix}`, async (c) => {
            const upload = c.get("upload");
            try {
                const subfolder = c.req.query("subfolder");
                const formData = await c.req.formData();
                const file = formData.get("file");
                if (!file || !(file instanceof File)) return c.json({ error: "No file" }, 400);

                if (file.size > this.config.maxFileSize) return c.json({ error: "File too large" }, 400);
                if (this.config.allowedExtensions.length > 0) {
                    if (!this.config.allowedExtensions.some(e => file.name.toLowerCase().endsWith(e))) {
                        return c.json({ error: "Invalid extension" }, 400);
                    }
                }

                const data = new Uint8Array(await file.arrayBuffer());
                const result = await upload.upload(file.name, data, subfolder, { contentType: file.type });
                return c.json({ success: true, ...result });

            } catch (e: any) {
                return c.json({ error: e.message }, 500);
            }
        });

        // GET — list files
        app.get(`${prefix}`, async (c) => {
            const upload = c.get("upload");
            try {
                const subfolder = c.req.query("subfolder");
                const files = await upload.list(subfolder);
                return c.json({ success: true, files });
            } catch (e: any) {
                return c.json({ error: e.message }, 500);
            }
        });

        // GET — download a file
        app.get(`${prefix}/*`, async (c) => {
            const upload = c.get("upload");
            try {
                const filePath = c.req.path.replace(`${prefix}/`, "");
                const segments = filePath.split("/");
                const filename = segments.pop() || "";
                const subfolder = segments.length > 0 ? segments.join("/") : undefined;

                const data = await upload.get(filename, subfolder);
                if (!data) {
                    return c.json({ error: "File not found" }, 404);
                }

                const ext = filename.split(".").pop()?.toLowerCase() || "";
                const mimeTypes: Record<string, string> = {
                    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
                    pdf: "application/pdf", txt: "text/plain", json: "application/json", zip: "application/zip",
                };
                const contentType = mimeTypes[ext] || "application/octet-stream";

                const body = new Uint8Array(data.length);
                body.set(data);

                return new Response(body, {
                    headers: {
                        "Content-Type": contentType,
                        "Content-Disposition": `inline; filename="${filename}"`,
                        "Content-Length": String(data.length),
                    },
                });
            } catch (e: any) {
                return c.json({ error: e.message }, 500);
            }
        });

        // DELETE — delete a file
        app.delete(`${prefix}/*`, async (c) => {
            const upload = c.get("upload");
            try {
                const filePath = c.req.path.replace(`${prefix}/`, "");
                const segments = filePath.split("/");
                const filename = segments.pop() || "";
                const subfolder = segments.length > 0 ? segments.join("/") : undefined;

                await upload.delete(filename, subfolder);
                return new Response(null, { status: 204 });
            } catch (e: any) {
                return c.json({ error: e.message }, 500);
            }
        });
    }
}
