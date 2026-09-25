import type { Feature, CorsConfig } from "../types";
import type { Kernel } from "../kernel";
import { cors } from "hono/cors";
import { consoleLogger, type KernelLogger } from "../logging";

export class CorsFeature implements Feature {
    name = "cors";
    private log: KernelLogger = consoleLogger;

    constructor(private config: CorsConfig = {}) {
        if (!this.config.origin) {
            this.config.origin = "*";
        }
        if (this.config.credentials === undefined) {
            this.config.credentials = false;
        }
    }

    async initialize(kernel: Kernel): Promise<void> {
        this.log = kernel.getLogger();
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
        this.log.debug("CORS feature initialized");
    }
}
