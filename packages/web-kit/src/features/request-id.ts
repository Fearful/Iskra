import type { Feature, RequestIdConfig } from "../types";
import type { Kernel } from "../kernel";
import type { Context, Next } from "hono";

// Extend Hono's context with requestId
declare module "hono" {
    interface ContextVariableMap {
        requestId: string;
    }
}

export class RequestIdFeature implements Feature {
    name = "request-id";

    private config: Required<RequestIdConfig>;

    constructor(config: RequestIdConfig = {}) {
        this.config = {
            headerName: config.headerName || "X-Request-ID",
            generator: config.generator || this.defaultGenerator,
        };
    }

    async initialize(kernel: Kernel): Promise<void> {
        const app = kernel.getApp();

        app.use("*", async (c: Context, next: Next) => {
            let requestId = c.req.header(this.config.headerName);

            if (!requestId) {
                requestId = this.config.generator();
            }

            c.set("requestId", requestId);
            await next();
            c.res.headers.set(this.config.headerName, requestId);
        });

        console.log("✅ Request ID feature initialized");
    }

    private defaultGenerator(): string {
        return crypto.randomUUID();
    }
}
