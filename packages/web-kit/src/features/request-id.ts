import type { Feature, RequestIdConfig } from '../types';
import type { Kernel } from '../kernel';
import type { Context, Next } from 'hono';
import { consoleLogger, type KernelLogger } from '../logging';

// Extend Hono's context with requestId
declare module 'hono' {
    interface ContextVariableMap {
        requestId: string;
    }
}

/**
 * An incoming ID is kept only if it is visible ASCII (UUIDs, trace headers
 * such as `Root=1-…;Parent=…`), up to 200 characters: it is echoed back and
 * written to the logs, so a client could otherwise fill them with anything.
 */
const ACCEPTED_REQUEST_ID = /^[\x21-\x7e]{1,200}$/;

export class RequestIdFeature implements Feature {
    name = 'request-id';
    private log: KernelLogger = consoleLogger;

    private config: Required<RequestIdConfig>;

    constructor(config: RequestIdConfig = {}) {
        this.config = {
            headerName: config.headerName || 'X-Request-ID',
            generator: config.generator || this.defaultGenerator,
        };
    }

    async initialize(kernel: Kernel): Promise<void> {
        this.log = kernel.getLogger();
        const app = kernel.getApp();

        app.use('*', async (c: Context, next: Next) => {
            let requestId = c.req.header(this.config.headerName);

            if (!requestId || !ACCEPTED_REQUEST_ID.test(requestId)) {
                requestId = this.config.generator();
            }

            c.set('requestId', requestId);
            await next();
            c.res.headers.set(this.config.headerName, requestId);
        });

        this.log.debug('Request ID feature initialized');
    }

    private defaultGenerator(): string {
        return crypto.randomUUID();
    }
}
