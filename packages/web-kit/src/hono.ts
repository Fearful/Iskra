/**
 * `@iskra-bun/web-kit/hono`: Hono as web-kit uses it.
 *
 * web-kit's API is written in Hono types (`Kernel.getApp()`, `Feature.routes()`,
 * the `ContextVariableMap` entries). An app that imports `hono` itself can end
 * up with a second copy next to web-kit's, and then a `HTTPException` of one
 * copy is not an `instanceof` the other's. Import these from here instead, or
 * keep `hono` in the range web-kit declares as a peer dependency.
 */
import { STATUS_CODES } from 'node:http';
import { HTTPException } from 'hono/http-exception';

export { Hono } from 'hono';
export { HTTPException };
export { createMiddleware } from 'hono/factory';
export type {
    Context,
    ContextVariableMap,
    Env,
    ErrorHandler,
    Handler,
    HonoRequest,
    Input,
    MiddlewareHandler,
    Next,
    NotFoundHandler,
    Schema,
    TypedResponse,
    ValidationTargets,
} from 'hono';
export type {
    ClientErrorStatusCode,
    ContentfulStatusCode,
    ContentlessStatusCode,
    RedirectStatusCode,
    ServerErrorStatusCode,
    StatusCode,
    SuccessStatusCode,
} from 'hono/utils/http-status';

/**
 * Whether `err` is a Hono `HTTPException`, from this copy of Hono or another
 * one: an `Error` with an HTTP `status` and `getResponse()`.
 */
export function isHTTPException(err: unknown): err is HTTPException {
    if (err instanceof HTTPException) return true;
    if (!(err instanceof Error)) return false;
    const candidate = err as Error & { status?: unknown; getResponse?: unknown };
    return (
        typeof candidate.getResponse === 'function' &&
        Number.isInteger(candidate.status) &&
        (candidate.status as number) >= 100 &&
        (candidate.status as number) <= 599
    );
}

/** The reason phrase of an HTTP status (`404` → `"Not Found"`), or `""` for an unknown one. */
export function statusText(status: number): string {
    return STATUS_CODES[status] ?? '';
}
