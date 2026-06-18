import type { Feature, LoggerConfig } from "../types";
import type { Kernel } from "../kernel";
import type { Context, Next } from "hono";

declare module "hono" {
    interface ContextVariableMap {
        logger: any;
    }
}

// Simple Logger implementation to avoid heavy dependency unless necessary
class SimpleLogger {
    constructor(private config: LoggerConfig) { }

    info(message: string, ...args: any[]) {
        if (this.shouldLog("info")) console.log(`[INFO] ${message}`, ...args);
    }
    error(message: string, ...args: any[]) {
        if (this.shouldLog("error")) console.error(`[ERROR] ${message}`, ...args);
    }
    warn(message: string, ...args: any[]) {
        if (this.shouldLog("warn")) console.warn(`[WARN] ${message}`, ...args);
    }
    debug(message: string, ...args: any[]) {
        if (this.shouldLog("debug")) console.debug(`[DEBUG] ${message}`, ...args);
    }

    private shouldLog(level: string) {
        // Basic level check (can be improved)
        return true;
    }
}

export class LoggerFeature implements Feature {
    name = "logger";

    private config: LoggerConfig;
    private logger: SimpleLogger;

    constructor(config: LoggerConfig = {}) {
        this.config = config;
        this.logger = new SimpleLogger(config);
    }

    async initialize(kernel: Kernel): Promise<void> {
        const app = kernel.getApp();

        app.use("*", async (c: Context, next: Next) => {
            c.set("logger", this.logger);
            await next();
        });

        if (this.config.logRequests) {
            app.use("*", async (c: Context, next: Next) => {
                const start = Date.now();
                const requestId = c.get("requestId");
                this.logger.info(`Incoming request ${c.req.method} ${c.req.path}`, { requestId });

                await next();

                const duration = Date.now() - start;
                if (this.config.logResponses) {
                    this.logger.info(`Request completed ${c.res.status} ${duration}ms`, { requestId });
                }
            });
        }

        console.log("✅ Logger feature initialized");
    }
}
