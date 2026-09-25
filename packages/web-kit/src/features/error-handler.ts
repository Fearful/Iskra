import type { Feature, ErrorHandlerConfig } from "../types";
import type { Kernel } from "../kernel";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { IskraError } from '@iskra-bun/core';
import { HttpError, ValidationError } from '../errors';
import { consoleLogger, type KernelLogger } from "../logging";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export class ErrorHandlerFeature implements Feature {
    name = "error-handler";
    private log: KernelLogger = consoleLogger;

    private config: ErrorHandlerConfig;

    constructor(config: ErrorHandlerConfig = {}) {
        this.config = {
            includeStack: config.includeStack !== undefined
                ? config.includeStack
                : process.env.NODE_ENV === "development",
            customHandlers: config.customHandlers,
            logger: config.logger,
        };
    }

    async initialize(kernel: Kernel): Promise<void> {
        this.log = kernel.getLogger();
        const app = kernel.getApp();

        app.onError((err, c) => {
            return this.handleError(err, c);
        });

        this.log.debug("Error handler feature initialized");
    }

    private handleError(err: Error | HTTPException, c: Context): Response {
        if (this.config.logger) {
            this.config.logger(err as Error, c);
        } else {
            this.log.error("Unhandled error", err);
        }

        // Iskra HttpError — convertir a HTTPException para mantener compatibilidad con Hono
        if (err instanceof HttpError) {
            const status = err.status;
            if (this.config.customHandlers?.[status]) {
                return this.config.customHandlers[status](err, c);
            }

            const response: any = {
                error: err.message,
                status,
                code: err.code,
            };

            if (err instanceof ValidationError && err.details !== undefined) {
                response.details = err.details;
            }

            if (Object.keys(err.context).length > 0) {
                response.context = err.context;
            }

            if (this.config.includeStack && err.stack) {
                response.stack = err.stack;
            }

            const requestId = c.get("requestId");
            if (requestId) response.requestId = requestId;

            return c.json(response, status as ContentfulStatusCode);
        }

        // IskraError genérico (no-HTTP) — devolver como 500
        if (err instanceof IskraError) {
            const status = 500;
            if (this.config.customHandlers?.[status]) {
                return this.config.customHandlers[status](err, c);
            }

            const response: any = {
                error: this.config.includeStack ? err.message : "Internal Server Error",
                status,
                code: err.code,
            };

            if (this.config.includeStack && err.stack) {
                response.stack = err.stack;
            }

            const requestId = c.get("requestId");
            if (requestId) response.requestId = requestId;

            return c.json(response, status);
        }

        // Hono HTTPException nativa
        if (err instanceof HTTPException) {
            const status = err.status;
            if (this.config.customHandlers?.[status]) {
                return this.config.customHandlers[status](err, c);
            }
            // A custom response (e.g. basicAuth's 401 with WWW-Authenticate,
            // which makes the browser prompt) is sent as is.
            if (err.res) return err.getResponse();

            const response: any = {
                error: err.message || this.getStatusText(status),
                status,
            };

            if (this.config.includeStack && err.stack) {
                response.stack = err.stack;
            }

            return c.json(response, status);
        }

        // Error genérico
        const status = 500;
        if (this.config.customHandlers?.[status]) {
            return this.config.customHandlers[status](err, c);
        }

        const response: any = {
            error: this.config.includeStack ? err.message : "Internal Server Error",
            status,
        };

        if (this.config.includeStack && err.stack) {
            response.stack = err.stack;
        }

        const requestId = c.get("requestId");
        if (requestId) {
            response.requestId = requestId;
        }

        return c.json(response, status);
    }

    private getStatusText(status: number): string {
        const statusTexts: Record<number, string> = {
            400: "Bad Request",
            401: "Unauthorized",
            403: "Forbidden",
            404: "Not Found",
            500: "Internal Server Error",
        };
        return statusTexts[status] || "Error";
    }
}

export function createHttpError(status: number, message: string): HTTPException {
    // @ts-expect-error - status is a number, HTTPException expects a ContentfulStatusCode
    return new HTTPException(status, { message });
}
