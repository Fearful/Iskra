import type { Feature, CorsConfig } from "../types";
import type { Kernel } from "../kernel";
import { cors } from "hono/cors";

export class CorsFeature implements Feature {
    name = "cors";

    constructor(private config: CorsConfig = {}) {
        if (!this.config.origin) {
            this.config.origin = "*";
        }
        if (this.config.credentials === undefined) {
            this.config.credentials = false;
        }
    }

    async initialize(kernel: Kernel): Promise<void> {
        const app = kernel.getApp();

        const honoConfig: any = { ...this.config };

        if (typeof this.config.origin === "function") {
            honoConfig.origin = (origin: string) => {
                // @ts-expect-error - origin is narrowed to a function above
                const result = this.config.origin(origin);
                return result ? origin : null;
            };
        }

        app.use("*", cors(honoConfig));
        console.log("✅ CORS feature initialized");
    }
}
