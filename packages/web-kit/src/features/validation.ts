import type { Feature } from "../types";
import type { Kernel } from "../kernel";
import type { Context, Next, Hono, Handler } from "hono";
import { z } from "zod";
import { ErrorCodes, errorResponse } from "../responses";

// Extend Hono Context to include valid() method
declare module "hono" {
    interface Context {
        valid<T = any>(): T;
    }
}

// Extend Hono to include *Validated methods if possible, 
// or simpler: just provide middleware factory.
// Monkey patching Hono class is tricky in strict TS if types aren't augmented in global/module scope correctly.
// But we can try to follow kollective's approach if we augment module "hono".

export interface ValidationSchema {
    params?: z.ZodSchema<any>;
    query?: z.ZodSchema<any>;
    body?: z.ZodSchema<any>;
}

export interface ValidationOptions {
    logErrors?: boolean;
    status?: number;
}

function createValidationMiddleware(schema: ValidationSchema, options: ValidationOptions = {}) {
    const { logErrors = true, status = 400 } = options;

    return async (c: Context, next: Next) => {
        try {
            const validated: Record<string, any> = {};

            if (schema.params) {
                const parsed = schema.params.safeParse(c.req.param());
                if (!parsed.success) {
                    return c.json(errorResponse("Invalid route params", ErrorCodes.VALIDATION_ERROR, parsed.error.flatten()), status as any);
                }
                validated.params = parsed.data;
            }

            if (schema.query) {
                const parsed = schema.query.safeParse(c.req.query());
                if (!parsed.success) {
                    return c.json(errorResponse("Invalid query params", ErrorCodes.VALIDATION_ERROR, parsed.error.flatten()), status as any);
                }
                validated.query = parsed.data;
            }

            if (schema.body) {
                let data: unknown = {};
                const contentType = c.req.header("content-type") || "";
                if (contentType.includes("application/json")) {
                    data = await c.req.json().catch(() => ({}));
                } else if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
                    data = await c.req.parseBody();
                }

                const parsed = schema.body.safeParse(data);
                if (!parsed.success) {
                    return c.json(errorResponse("Invalid body", ErrorCodes.VALIDATION_ERROR, parsed.error.flatten()), status as any);
                }
                validated.body = parsed.data;
            }

            // Attach to context
            (c as any).valid = () => validated;

            await next();
        } catch (err) {
            if (logErrors) console.error("Validation error:", err);
            return c.json(errorResponse("Validation middleware failed", ErrorCodes.INTERNAL_ERROR), 500);
        }
    };
}

// Helper to monkey patch Hono
function extendHonoWithValidation(app: Hono) {
    const methods = ["get", "post", "put", "delete"] as const;
    for (const method of methods) {
        (app as any)[`${method}Validated`] = function (path: string, schema: ValidationSchema, handler: Handler, options?: ValidationOptions) {
            const middleware = createValidationMiddleware(schema, options);
            (this as any)[method](path, middleware, handler);
            return this;
        };
    }
}

export class ValidationFeature implements Feature {
    name = "validation";

    async initialize(kernel: Kernel): Promise<void> {
        const app = kernel.getApp();
        extendHonoWithValidation(app);

        // Add context helper if not already present via middleware factory logic
        // The middleware factory adds .valid() to the SPECIFIC request context
        console.log("✅ Validation feature initialized");
    }
}

export { createValidationMiddleware };
