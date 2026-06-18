import type { Feature } from "../types";
import type { Kernel } from "../kernel";
import type { Context, Next, Hono, Handler } from "hono";
import Ajv from "ajv";
import addErrors from "ajv-errors";
import addFormats from "ajv-formats";
import type { ErrorObject } from "ajv";
import { ErrorCodes, errorResponse } from "../responses";

// ─── Module Augmentation ────────────────────────────────────────────────────

declare module "hono" {
    interface Hono {
        getJsonValidated(path: string, schema: JsonValidationSchema, handler: Handler, options?: JsonValidationOptions): Hono;
        postJsonValidated(path: string, schema: JsonValidationSchema, handler: Handler, options?: JsonValidationOptions): Hono;
        putJsonValidated(path: string, schema: JsonValidationSchema, handler: Handler, options?: JsonValidationOptions): Hono;
        deleteJsonValidated(path: string, schema: JsonValidationSchema, handler: Handler, options?: JsonValidationOptions): Hono;
    }
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface JsonValidationSchema {
    params?: Record<string, unknown>;
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
}

export interface JsonValidationOptions {
    logErrors?: boolean;
    status?: number;
    allErrors?: boolean;
    coerceTypes?: boolean;
}

export interface FormattedValidationErrors {
    fields: Record<string, string[]>;
    errors: string[];
}

// ─── Ajv Instance Factory ───────────────────────────────────────────────────

function createAjvInstance(options: JsonValidationOptions = {}): Ajv {
    const ajv = new Ajv({
        allErrors: options.allErrors ?? true,
        coerceTypes: options.coerceTypes ?? true,
        verbose: true,
        $data: true,
    });
    addFormats(ajv);
    addErrors(ajv);
    return ajv;
}

// ─── Error Formatter ────────────────────────────────────────────────────────

function formatAjvErrors(errors: ErrorObject[] | null | undefined): FormattedValidationErrors {
    const result: FormattedValidationErrors = { fields: {}, errors: [] };
    if (!errors) return result;

    for (const err of errors) {
        let fieldPath: string;

        if (err.instancePath) {
            fieldPath = err.instancePath.replace(/^\//, "").replace(/\//g, ".");
        } else if (err.params && "missingProperty" in err.params) {
            fieldPath = err.params.missingProperty as string;
        } else {
            fieldPath = "_root";
        }

        const message = err.message || "Invalid value";

        if (!result.fields[fieldPath]) {
            result.fields[fieldPath] = [];
        }

        if (!result.fields[fieldPath].includes(message)) {
            result.fields[fieldPath].push(message);
        }

        const formatted = fieldPath === "_root" ? message : `${fieldPath}: ${message}`;
        if (!result.errors.includes(formatted)) {
            result.errors.push(formatted);
        }
    }

    return result;
}

// ─── Validation Middleware ───────────────────────────────────────────────────

export function createJsonSchemaValidationMiddleware(
    schema: JsonValidationSchema,
    options: JsonValidationOptions = {},
) {
    const { logErrors = true, status = 400 } = options;
    const ajv = createAjvInstance(options);

    const validators = {
        params: schema.params ? ajv.compile(schema.params) : null,
        query: schema.query ? ajv.compile(schema.query) : null,
        body: schema.body ? ajv.compile(schema.body) : null,
    };

    return async (c: Context, next: Next) => {
        try {
            const validated: Record<string, any> = {};

            if (validators.params) {
                const data = { ...c.req.param() };
                const valid = validators.params(data);
                if (!valid) {
                    const details = formatAjvErrors(validators.params.errors);
                    return c.json(errorResponse("Invalid route params", ErrorCodes.VALIDATION_ERROR, details), status as any);
                }
                validated.params = data;
            }

            if (validators.query) {
                const data = { ...c.req.query() };
                const valid = validators.query(data);
                if (!valid) {
                    const details = formatAjvErrors(validators.query.errors);
                    return c.json(errorResponse("Invalid query params", ErrorCodes.VALIDATION_ERROR, details), status as any);
                }
                validated.query = data;
            }

            if (validators.body) {
                let data: unknown = {};
                const contentType = c.req.header("content-type") || "";
                if (contentType.includes("application/json")) {
                    data = await c.req.json().catch(() => ({}));
                } else if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
                    data = await c.req.parseBody();
                }

                const valid = validators.body(data);
                if (!valid) {
                    const details = formatAjvErrors(validators.body.errors);
                    return c.json(errorResponse("Invalid body", ErrorCodes.VALIDATION_ERROR, details), status as any);
                }
                validated.body = data;
            }

            (c as any).valid = () => validated;
            await next();
        } catch (err) {
            if (logErrors) console.error("JSON Schema validation error:", err);
            return c.json(errorResponse("Validation middleware failed", ErrorCodes.INTERNAL_ERROR), 500);
        }
    };
}

// ─── Hono Extension ─────────────────────────────────────────────────────────

function extendHonoWithJsonSchemaValidation(app: Hono) {
    const methods = ["get", "post", "put", "delete"] as const;
    for (const method of methods) {
        (app as any)[`${method}JsonValidated`] = function (
            path: string,
            schema: JsonValidationSchema,
            handler: Handler,
            options?: JsonValidationOptions,
        ) {
            const middleware = createJsonSchemaValidationMiddleware(schema, options);
            (this as any)[method](path, middleware, handler);
            return this;
        };
    }
}

// ─── Feature Class ──────────────────────────────────────────────────────────

export class JsonSchemaValidationFeature implements Feature {
    name = "json-schema-validation";

    async initialize(kernel: Kernel): Promise<void> {
        const app = kernel.getApp();
        extendHonoWithJsonSchemaValidation(app);
        console.log("✅ JSON Schema validation feature initialized");
    }
}

export { formatAjvErrors };
