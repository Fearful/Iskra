import type { Feature, ErrorHandlerConfig } from '../types';
import type { Kernel } from '../kernel';
import { HTTPException } from 'hono/http-exception';
import { nodeEnv } from '@iskra-bun/core';

/**
 * How the Kernel reports errors: `includeStack`, a handler per status
 * (`customHandlers`) and a logger for them. The Kernel answers every error by
 * the response contract with or without this feature; it only changes those.
 */
export class ErrorHandlerFeature implements Feature {
    name = 'error-handler';

    private config: ErrorHandlerConfig;

    constructor(config: ErrorHandlerConfig = {}) {
        this.config = {
            includeStack: config.includeStack !== undefined ? config.includeStack : nodeEnv() === 'development',
            customHandlers: config.customHandlers,
            logger: config.logger,
        };
    }

    async initialize(kernel: Kernel): Promise<void> {
        kernel.configureErrors({
            includeStack: this.config.includeStack === true,
            customHandlers: this.config.customHandlers,
            logger: this.config.logger,
        });
        kernel.getLogger().debug('Error handler feature initialized');
    }
}

export function createHttpError(status: number, message: string): HTTPException {
    // @ts-expect-error - status is a number, HTTPException expects a ContentfulStatusCode
    return new HTTPException(status, { message });
}
