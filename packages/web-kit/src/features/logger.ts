import type { Feature, LoggerConfig } from "../types";
import type { Kernel } from "../kernel";
import type { Context, Next } from "hono";
import { consoleLogger, type KernelLogger } from "../logging";

declare module "hono" {
    interface ContextVariableMap {
        logger: any;
    }
}

/** Severity order of LoggerConfig["level"]; a message is written at or above the configured one. */
const LEVELS = ["trace", "debug", "info", "warning", "error", "fatal"] as const;
type Level = (typeof LEVELS)[number];

// Simple Logger implementation to avoid heavy dependency unless necessary.
// Writing to the console with [LEVEL] prefixes is what this feature is for.
/* eslint-disable no-console */
class SimpleLogger {
    constructor(private config: LoggerConfig) { }

    info(message: string, ...args: any[]) {
        if (this.shouldLog("info")) console.log(`[INFO] ${message}`, ...args);
    }
    error(message: string, ...args: any[]) {
        if (this.shouldLog("error")) console.error(`[ERROR] ${message}`, ...args);
    }
    warn(message: string, ...args: any[]) {
        if (this.shouldLog("warning")) console.warn(`[WARN] ${message}`, ...args);
    }
    debug(message: string, ...args: any[]) {
        if (this.shouldLog("debug")) console.debug(`[DEBUG] ${message}`, ...args);
    }

    /** Without a configured level everything is written, as before `level` was honored. */
    private shouldLog(level: Level) {
        const min = this.config.level;
        if (!min) return true;
        return LEVELS.indexOf(level) >= LEVELS.indexOf(min);
    }
}
/* eslint-enable no-console */

export class LoggerFeature implements Feature {
    name = "logger";
    private log: KernelLogger = consoleLogger;

    private config: LoggerConfig;
    private logger: SimpleLogger;

    constructor(config: LoggerConfig = {}) {
        this.config = config;
        this.logger = new SimpleLogger(config);
    }

    async initialize(kernel: Kernel): Promise<void> {
        this.log = kernel.getLogger();
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

        this.log.debug("Logger feature initialized");
    }
}
