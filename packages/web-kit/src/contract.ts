import type { Context } from 'hono';
import type { ContentfulStatusCode, StatusCode } from 'hono/utils/http-status';
import { ErrorCodes, IskraError, type ErrorCode } from '@iskra-bun/core';
import { HttpError, ValidationError } from './errors';
import { isHTTPException, statusText } from './hono';
import { silentLogger, type KernelLogger } from './logging';
import { successResponse } from './responses';
import { codeForStatus, statusForCode } from './status-codes';
import type { ErrorHandlerConfig } from './types';
import type { ValidationDetails } from './bind';

/**
 * An error as the response contract sees it: what the client is told and with
 * which status. The Kernel builds one for every error (thrown, a 404, a failed
 * validation, a feature's refusal) and the contract turns it into the body.
 */
export interface Problem {
    status: number;
    code: ErrorCode;
    /**
     * What the client may read: the message of an `HttpError`, a Hono
     * `HTTPException` or an error marked `expose`; for anything else the
     * status text (`Internal Server Error`), unless `includeStack` is on.
     */
    message: string;
    /** A validation's details (which fields failed and why). */
    details?: unknown;
    /** An `HttpError`'s context: sent for a 4xx, or with `includeStack`. */
    context?: Record<string, unknown>;
    /** Only with `includeStack`. */
    stack?: string;
    /** The request's id, when RequestIdFeature set one. */
    requestId?: string;
    /** Headers the response carries: `Allow` for a 405, `WWW-Authenticate` for a 401. */
    headers?: Record<string, string>;
}

/** A page of a list, for `list(c, page)`: db-oracle's `paginate()` and `oracle.list()` results fit as they are. */
export interface ListPage<T = unknown> {
    /** The rows (or `rows`, as `oracle.list()` names them). */
    items?: readonly T[];
    rows?: readonly T[];
    /** Rows in total, before any filter. */
    total?: number;
    /** Rows that match the filter. */
    filtered?: number;
    page?: number;
    pageSize?: number;
    offset?: number | null;
    limit?: number | null;
    pages?: number;
    nextCursor?: string | null;
}

/** A page as a contract's `list()` gets it: `items` always set. */
export type NormalizedPage<T = unknown> = Omit<ListPage<T>, 'items' | 'rows'> & { items: readonly T[] };

export interface OkOptions {
    /** Default 200. */
    status?: number;
    message?: string;
}

/**
 * The shape of every response: set once (`KernelConfig.contract`, or
 * WebPlugin's) and followed by the Kernel's error handler, its 404, the
 * validation middlewares, the features that refuse a request (auth, API keys,
 * rate limit, CSRF, uploads) and the `ok()`, `list()` and `fail()` helpers.
 */
export interface ResponseContract {
    /**
     * The problem for an error the app throws, to recognize its own error
     * classes; `undefined` leaves the error to Iskra's mapping.
     */
    toProblem?(error: unknown, c: Context): Problem | undefined;
    /**
     * The body of an error response, or a `Response` to send as is. A HEAD
     * request gets no body (nor content type) whatever it returns.
     */
    error(problem: Problem, c: Context, error: unknown): unknown;
    /** The body of `ok(c, data)`. Default `{ success: true, data, message? }`. */
    success?(data: unknown, c: Context, options: OkOptions): unknown;
    /** The body of `list(c, page)`. Default `{ success: true, data: items, meta }`. */
    list?(page: NormalizedPage, c: Context): unknown;
    /**
     * The `details` of a failed validation (`validate()`, `bindBody()`,
     * `bindQuery()`): `'flatten'` (the default), `'issues'`, `'fields'` or a
     * function of the issues.
     */
    validationDetails?: ValidationDetails;
    /**
     * Logs every problem, instead of the Kernel logging the errors thrown (a
     * 5xx at `error`, a 4xx at `debug`); it also sees the ones a feature or a
     * validation answers without throwing.
     */
    log?(problem: Problem, c: Context, error: unknown): void;
}

/** `value` without its undefined properties, so they are not serialized as absent keys. */
function compact<T extends object>(value: T): T {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/**
 * Iskra's contract, the default: the error body the Python and Java SDKs read
 * (`{ error, status, code, details?, context?, stack?, requestId? }`).
 */
export const iskraContract: ResponseContract = {
    error: (problem) =>
        compact({
            error: problem.message,
            status: problem.status,
            code: problem.code,
            details: problem.details,
            context: problem.context,
            stack: problem.stack,
            requestId: problem.requestId,
        }),
    success: (data, _c, options) => successResponse(data, options.message),
    list: (page) => {
        const { items, ...meta } = page;
        return { success: true, data: items, meta: compact(meta) };
    },
};

/**
 * RFC 9457 problem details (`application/problem+json`):
 * `{ type, title, status, detail, code, instance, errors?, requestId? }`.
 * `type` defaults to `about:blank`; pass a function to link each code to a page.
 */
export function problemDetailsContract(options: { type?: (problem: Problem) => string } = {}): ResponseContract {
    return {
        ...iskraContract,
        error: (problem, c) =>
            new Response(
                JSON.stringify(
                    compact({
                        type: options.type?.(problem) ?? 'about:blank',
                        title: statusText(problem.status) || 'Error',
                        status: problem.status,
                        detail: problem.message,
                        code: problem.code,
                        instance: c.req.path,
                        errors: problem.details,
                        requestId: problem.requestId,
                        stack: problem.stack,
                    }),
                ),
                { status: problem.status, headers: { 'Content-Type': 'application/problem+json' } },
            ),
    };
}

/** How the Kernel reports errors: ErrorHandlerFeature's options. */
export interface ErrorOptions {
    /** Send the stack, the context of 5xx errors and the message of hidden ones. */
    includeStack: boolean;
    customHandlers?: ErrorHandlerConfig['customHandlers'];
    logger?: ErrorHandlerConfig['logger'];
}

/**
 * Iskra's mapping of an error to a problem: an `HttpError` keeps its status,
 * code and message; a Hono `HTTPException` its status and message; any other
 * `IskraError` answers the status of its code (`NOT_FOUND` → 404, 500 for
 * the rest) and shows its message only if marked `expose`; anything else is
 * a 500 that shows nothing.
 */
export function toProblem(error: unknown, includeStack = false): Problem {
    const stack = includeStack && error instanceof Error ? error.stack : undefined;
    if (error instanceof HttpError) {
        const context = Object.keys(error.context).length > 0 ? error.context : undefined;
        return compact<Problem>({
            status: error.status,
            code: error.code,
            message: error.message,
            details: error instanceof ValidationError ? error.details : undefined,
            context: error.status < 500 || includeStack ? context : undefined,
            stack,
            headers: error.headers,
        });
    }
    if (isHTTPException(error)) {
        return compact<Problem>({
            status: error.status,
            code: codeForStatus(error.status),
            message: error.message || statusText(error.status),
            stack,
        });
    }
    if (error instanceof IskraError) {
        const status = statusForCode(error.code);
        const exposed = (error as { expose?: unknown }).expose === true || includeStack;
        const context = Object.keys(error.context).length > 0 ? error.context : undefined;
        return compact<Problem>({
            status,
            code: error.code,
            message: exposed ? error.message : statusText(status),
            context: includeStack ? context : undefined,
            stack,
        });
    }
    return compact<Problem>({
        status: 500,
        code: ErrorCodes.INTERNAL_ERROR,
        message: includeStack && error instanceof Error ? error.message : 'Internal Server Error',
        stack,
    });
}

/** A problem from its status, and optionally its code, message and the rest. */
export function problem(status: number, init: Partial<Omit<Problem, 'status'>> = {}): Problem {
    const { code, message, ...rest } = init;
    return compact({ status, code: code ?? codeForStatus(status), message: message ?? statusText(status), ...rest });
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

/**
 * Answers requests by the contract: the Kernel's error handler and 404, and
 * the `ok()`, `list()` and `fail()` helpers, which find it on the context.
 */
export class Responder {
    constructor(
        readonly contract: ResponseContract,
        private readonly logger: () => KernelLogger,
        readonly options: ErrorOptions,
    ) {}

    /** The problem for an error: the contract's `toProblem`, else Iskra's mapping, with the request id. */
    toProblem(error: unknown, c: Context): Problem {
        const found = this.contract.toProblem?.(error, c) ?? toProblem(error, this.options.includeStack);
        const requestId = c.get('requestId');
        return requestId && found.requestId === undefined ? { ...found, requestId } : found;
    }

    /** Answers a thrown error: the Kernel's `onError`. */
    error(error: unknown, c: Context): Response | Promise<Response> {
        // A HTTPException that carries its response (basicAuth's 401 with
        // WWW-Authenticate, which makes the browser prompt) is sent as is.
        if (isHTTPException(error) && error.res) return error.getResponse();
        const found = this.toProblem(error, c);
        this.log(found, c, error);
        const custom = this.options.customHandlers?.[found.status];
        if (custom) return custom(asError(error), c);
        return this.render(c, found, error);
    }

    /**
     * Answers with a problem the caller built (a failed validation, a missing
     * file). Only the contract's `log` sees it: the caller logs what it must.
     */
    problem(c: Context, found: Problem, error?: unknown): Response {
        const requestId = c.get('requestId');
        const complete = requestId && found.requestId === undefined ? { ...found, requestId } : found;
        this.contract.log?.(complete, c, error);
        return this.render(c, complete, error);
    }

    ok(c: Context, data: unknown, options: OkOptions = {}): Response {
        const body = (this.contract.success ?? iskraContract.success!)(data, c, options);
        return this.send(c, body, options.status ?? 200);
    }

    list(c: Context, page: ListPage): Response {
        const { items, rows, ...rest } = page;
        const normalized: NormalizedPage = { ...rest, items: items ?? rows ?? [] };
        return this.send(c, (this.contract.list ?? iskraContract.list!)(normalized, c), 200);
    }

    private send(c: Context, body: unknown, status: number): Response {
        if (body instanceof Response) return body;
        return c.json(body, status as ContentfulStatusCode);
    }

    private render(c: Context, found: Problem, error: unknown): Response {
        for (const [name, value] of Object.entries(found.headers ?? {})) c.header(name, value);
        if (c.req.method === 'HEAD') return c.body(null, found.status as StatusCode);
        const body = this.contract.error(found, c, error);
        if (body instanceof Response) {
            // Through the context, so the headers set before (Retry-After) stay.
            return c.newResponse(body.body, { status: body.status as StatusCode, headers: body.headers });
        }
        return c.json(body, found.status as ContentfulStatusCode);
    }

    private log(found: Problem, c: Context, error: unknown): void {
        if (this.options.logger) {
            if (error !== undefined) this.options.logger(asError(error), c);
            return;
        }
        if (this.contract.log) {
            this.contract.log(found, c, error);
            return;
        }
        // Any client can cause as many 4xx as it likes: at error level they
        // would flood the log.
        if (found.status >= 500) this.logger().error('Unhandled error', error ?? found.message);
        else this.logger().debug(`Request failed with ${found.status}`, error ?? found.message);
    }
}

/** Outside a Kernel (a bare Hono app): Iskra's contract, logging nothing. */
const fallback = new Responder(iskraContract, () => silentLogger, { includeStack: false });

/** The responder of a request's Kernel, or one with the default contract outside a Kernel. */
export function responderOf(c: Context): Responder {
    return c.get('responder') ?? fallback;
}

/** `ok(c, data)`: a success response by the contract. */
export function ok(c: Context, data?: unknown, options?: OkOptions): Response {
    return responderOf(c).ok(c, data, options);
}

/** `list(c, page)`: a page of rows by the contract. */
export function list(c: Context, page: ListPage): Response {
    return responderOf(c).list(c, page);
}

/**
 * `fail(c, error)`: the error response the Kernel would give for `error`, as
 * a return value instead of a throw (logged the same way).
 */
export function fail(c: Context, error: unknown): Response | Promise<Response> {
    return responderOf(c).error(error, c);
}

declare module 'hono' {
    interface ContextVariableMap {
        /** The Kernel's responder: set on every request, read by `ok()`, `list()` and `fail()`. */
        responder?: Responder;
    }
}
