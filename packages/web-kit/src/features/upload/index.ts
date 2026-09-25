import type { Feature, UploadAction, UploadConfig } from "../../types";
import type { Kernel } from "../../kernel";
import type { Hono, Context, Next } from "hono";
import { UploadHelper, safeBasename } from "./helper";
import { consoleLogger, type KernelLogger } from "../../logging";

// Room for multipart boundaries and part headers on top of the file itself.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * Parses a multipart body, aborting as soon as more than `limit` bytes arrive
 * instead of buffering an arbitrarily large request first. Returns null when
 * the limit is exceeded.
 */
async function readFormDataWithin(req: Request, limit: number): Promise<FormData | null> {
    if (!req.body) return req.formData();
    let received = 0;
    let exceeded = false;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            received += chunk.byteLength;
            if (received > limit) {
                exceeded = true;
                controller.error(new Error("payload too large"));
            } else {
                controller.enqueue(chunk);
            }
        },
    });
    const limited = new Request(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body.pipeThrough(counter),
        duplex: "half",
    } as RequestInit);
    try {
        return await limited.formData();
    } catch (err) {
        if (exceeded) return null;
        throw err;
    }
}

declare module "hono" {
    interface ContextVariableMap {
        upload: UploadHelper;
    }
}

export class UploadFeature implements Feature {
    name = "upload";
    private log: KernelLogger = consoleLogger;
    dependencies = ["storage"];
    private helper?: UploadHelper;
    private config: Required<Omit<UploadConfig, "authorize">> & Pick<UploadConfig, "authorize">;

    constructor(config: UploadConfig) {
        if (config.exposeRoutes && !config.authorize) {
            // The routes can list, read, overwrite and delete every file of the
            // project; exposing them without a decision is never the safe default.
            throw new Error(
                "UploadFeature: exposeRoutes requires an `authorize(c, action)` callback " +
                    "(pass `authorize: () => true` to make the upload routes public on purpose)",
            );
        }
        this.config = {
            projectName: config.projectName,
            maxFileSize: config.maxFileSize || 10 * 1024 * 1024,
            allowedExtensions: config.allowedExtensions || [],
            exposeRoutes: config.exposeRoutes || false,
            routePrefix: config.routePrefix || "/upload",
            authorize: config.authorize,
        };
    }

    async initialize(kernel: Kernel): Promise<void> {
        this.log = kernel.getLogger();
        const storageFeature = kernel.getFeature("storage");
        if (!storageFeature) throw new Error("Upload feature requires storage feature");
        const storage = storageFeature.getAdapter();
        if (!storage) throw new Error("Storage adapter not ready");

        // Bun rejects a body above the Kernel's maxRequestBodySize (16 MiB by
        // default) with a bare 413 before any route runs, so a larger
        // maxFileSize would silently never be reachable.
        const bodyLimit = kernel.getConfig().maxRequestBodySize;
        if (this.config.exposeRoutes && bodyLimit !== undefined && this.config.maxFileSize + MULTIPART_OVERHEAD_BYTES > bodyLimit) {
            throw new Error(
                `UploadFeature: maxFileSize (${this.config.maxFileSize} bytes) plus multipart overhead ` +
                    `(${MULTIPART_OVERHEAD_BYTES}) exceeds the Kernel's maxRequestBodySize (${bodyLimit}); ` +
                    `raise maxRequestBodySize in the Kernel/WebPlugin config or lower maxFileSize`,
            );
        }

        this.helper = new UploadHelper(storage, this.config.projectName);

        const app = kernel.getApp();
        app.use("*", async (c: Context, next: Next) => {
            c.set("upload", this.helper!);
            await next();
        });

        this.log.debug(`Upload feature initialized: ${this.config.projectName}`);
    }

    routes(app: Hono) {
        if (!this.config.exposeRoutes) return;

        const prefix = this.config.routePrefix;
        const authorize = this.config.authorize!;
        const guard = (action: UploadAction) => async (c: Context, next: Next) => {
            if (!(await authorize(c, action))) return c.json({ error: "Forbidden" }, 403);
            await next();
        };
        // Internal errors are logged, never echoed: storage errors can carry
        // paths, bucket names or credentials hints.
        const fail = (c: Context, action: UploadAction, e: unknown) => {
            this.log.error(`[upload] ${action} failed`, e);
            return c.json({ error: `${action[0].toUpperCase()}${action.slice(1)} failed` }, 500);
        };

        // POST — upload a file
        app.post(`${prefix}`, guard("upload"), async (c) => {
            const upload = c.get("upload");
            const limit = this.config.maxFileSize + MULTIPART_OVERHEAD_BYTES;
            if (Number(c.req.header("content-length")) > limit) {
                return c.json({ error: "File too large" }, 413);
            }
            let formData: FormData | null;
            try {
                formData = await readFormDataWithin(c.req.raw, limit);
            } catch {
                return c.json({ error: "Invalid multipart body" }, 400);
            }
            if (!formData) return c.json({ error: "File too large" }, 413);

            try {
                const subfolder = c.req.query("subfolder");
                const file = formData.get("file");
                if (!file || !(file instanceof File)) return c.json({ error: "No file" }, 400);

                if (file.size > this.config.maxFileSize) return c.json({ error: "File too large" }, 413);
                if (this.config.allowedExtensions.length > 0) {
                    if (!this.config.allowedExtensions.some(e => file.name.toLowerCase().endsWith(e))) {
                        return c.json({ error: "Invalid extension" }, 400);
                    }
                }

                const data = new Uint8Array(await file.arrayBuffer());
                const result = await upload.upload(safeBasename(file.name), data, subfolder, { contentType: file.type });
                return c.json({ success: true, ...result });

            } catch (e) {
                return fail(c, "upload", e);
            }
        });

        // GET — list files
        app.get(`${prefix}`, guard("list"), async (c) => {
            const upload = c.get("upload");
            try {
                const subfolder = c.req.query("subfolder");
                const files = await upload.list(subfolder);
                return c.json({ success: true, files });
            } catch (e) {
                return fail(c, "list", e);
            }
        });

        // GET — download a file
        app.get(`${prefix}/*`, guard("download"), async (c) => {
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
                        "Content-Disposition": `inline; filename="${safeBasename(filename)}"`,
                        "Content-Length": String(data.length),
                    },
                });
            } catch (e) {
                return fail(c, "download", e);
            }
        });

        // DELETE — delete a file
        app.delete(`${prefix}/*`, guard("delete"), async (c) => {
            const upload = c.get("upload");
            try {
                const filePath = c.req.path.replace(`${prefix}/`, "");
                const segments = filePath.split("/");
                const filename = segments.pop() || "";
                const subfolder = segments.length > 0 ? segments.join("/") : undefined;

                await upload.delete(filename, subfolder);
                return new Response(null, { status: 204 });
            } catch (e) {
                return fail(c, "delete", e);
            }
        });
    }
}
