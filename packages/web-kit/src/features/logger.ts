import type { Feature, LoggerConfig } from '../types';
import type { Kernel } from '../kernel';
import type { Context, Next } from 'hono';
import { consoleLogger, type KernelLogger } from '../logging';

/** The per-request logger LoggerFeature puts on the context (`c.get("logger")`). */
export interface RequestLogger {
    info(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    debug(message: string, ...args: unknown[]): void;
}

declare module 'hono' {
    interface ContextVariableMap {
        logger: RequestLogger;
    }
}

/** Severity order of LoggerConfig["level"]; a message is written at or above the configured one. */
const LEVELS = ['trace', 'debug', 'info', 'warning', 'error', 'fatal'] as const;
type Level = (typeof LEVELS)[number];

// Simple Logger implementation to avoid heavy dependency unless necessary.
// Writing to the console with [LEVEL] prefixes is what this feature is for.
/* eslint-disable no-console */
class SimpleLogger implements RequestLogger {
    constructor(private config: LoggerConfig) {}

    info(message: string, ...args: unknown[]) {
        if (this.shouldLog('info')) console.log(`[INFO] ${message}`, ...args);
    }
    error(message: string, ...args: unknown[]) {
        if (this.shouldLog('error')) console.error(`[ERROR] ${message}`, ...args);
    }
    warn(message: string, ...args: unknown[]) {
        if (this.shouldLog('warning')) console.warn(`[WARN] ${message}`, ...args);
    }
    debug(message: string, ...args: unknown[]) {
        if (this.shouldLog('debug')) console.debug(`[DEBUG] ${message}`, ...args);
    }

    private shouldLog(level: Level) {
        return shouldLog(this.config, level);
    }
}

/** Without a configured level everything is written, as before `level` was honored. */
function shouldLog(config: LoggerConfig, level: Level) {
    const min = config.level;
    if (!min) return true;
    return LEVELS.indexOf(level) >= LEVELS.indexOf(min);
}
/* eslint-enable no-console */

/**
 * The request path for a log line, with control and line-separator characters
 * escaped: Hono decodes it, so `%0A` in a URL started a forged log line.
 */
function printablePath(path: string): string {
    return path.replace(
        // eslint-disable-next-line no-control-regex -- control characters are what it escapes
        /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g,
        (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
}

/** A request's logger over a logger with fields: its lines carry the request id. */
class BoundLogger implements RequestLogger {
    constructor(
        private readonly log: KernelLogger,
        private readonly config: LoggerConfig,
    ) {}

    info(message: string, ...args: unknown[]) {
        if (shouldLog(this.config, 'info')) this.log.info(message, detailsOf(args));
    }
    error(message: string, ...args: unknown[]) {
        if (shouldLog(this.config, 'error')) this.log.error(message, detailsOf(args));
    }
    warn(message: string, ...args: unknown[]) {
        if (shouldLog(this.config, 'warning')) this.log.warn(message, detailsOf(args));
    }
    debug(message: string, ...args: unknown[]) {
        if (shouldLog(this.config, 'debug')) this.log.debug(message, detailsOf(args));
    }
}

const detailsOf = (args: unknown[]) => (args.length === 0 ? undefined : args.length === 1 ? args[0] : args);

export class LoggerFeature implements Feature {
    name = 'logger';
    /** After RequestIdFeature, so a request's logger knows its id. */
    optionalDependencies = ['request-id'];
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
        const log = this.log;

        // With a logger that has fields (the App's pino), a request's logger
        // is its child with the request id; the console keeps its [LEVEL] lines.
        app.use('*', async (c: Context, next: Next) => {
            const requestId = c.get('requestId');
            c.set('logger', log.child ? new BoundLogger(log.child({ requestId }), this.config) : this.logger);
            await next();
        });

        if (this.config.accessLog) {
            app.use('*', async (c: Context, next: Next) => {
                const start = performance.now();
                await next();
                const actor = c.get('actor');
                const fields = {
                    method: c.req.method,
                    path: printablePath(c.req.path),
                    status: c.res.status,
                    durationMs: Math.round(performance.now() - start),
                    ...(c.get('requestId') ? { requestId: c.get('requestId') } : {}),
                    ...(actor ? { actor: `${actor.kind}:${actor.id}` } : {}),
                };
                if (log.child) log.child(fields).info('request completed');
                else log.info(`${fields.method} ${fields.path} ${fields.status} ${fields.durationMs}ms`, fields);
            });
        }

        if (this.config.logRequests) {
            app.use('*', async (c: Context, next: Next) => {
                const start = Date.now();
                const requestId = c.get('requestId');
                this.logger.info(`Incoming request ${c.req.method} ${printablePath(c.req.path)}`, { requestId });

                await next();

                const duration = Date.now() - start;
                if (this.config.logResponses) {
                    this.logger.info(`Request completed ${c.res.status} ${duration}ms`, { requestId });
                }
            });
        }

        this.log.debug('Logger feature initialized');
    }
}
