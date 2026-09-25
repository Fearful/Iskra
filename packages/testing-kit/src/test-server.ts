/**
 * Minimal structural interface for objects that accept a fetch-style request.
 * Matches Hono's `app.request()` signature without importing Hono.
 */
export interface RequestHandler {
    request(
        input: string | Request | URL,
        requestInit?: RequestInit,
        env?: unknown,
        executionCtx?: unknown,
    ): Response | Promise<Response>;
}

export interface TestServerClient {
    get(path: string, init?: RequestInit): Promise<Response>;
    post(path: string, body?: unknown, init?: RequestInit): Promise<Response>;
    put(path: string, body?: unknown, init?: RequestInit): Promise<Response>;
    patch(path: string, body?: unknown, init?: RequestInit): Promise<Response>;
    delete(path: string, init?: RequestInit): Promise<Response>;
}

/**
 * `init` with `body` as JSON. The caller's headers may be a `Headers`, tuples or
 * a record (spreading the first two lost them), and their `Content-Type`, in
 * any case, wins over the JSON default instead of being sent next to it.
 */
function buildJsonInit(body: unknown, base: RequestInit = {}): RequestInit {
    const headers = new Headers(base.headers);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    return {
        ...base,
        headers,
        body: JSON.stringify(body),
    };
}

/**
 * Wraps any object with a `.request()` method (structurally typed — no Hono
 * import required) in a small fetch-style client for testing HTTP handlers.
 *
 * Usage:
 *   const client = createTestServer(honoApp);
 *   const res = await client.get('/health');
 *   expect(res.status).toBe(200);
 */
export function createTestServer(handler: RequestHandler): TestServerClient {
    return {
        get(path, init) {
            return Promise.resolve(handler.request(path, { method: 'GET', ...init }));
        },
        post(path, body, init) {
            return Promise.resolve(
                handler.request(
                    path,
                    body !== undefined ? { method: 'POST', ...buildJsonInit(body, init) } : { method: 'POST', ...init },
                ),
            );
        },
        put(path, body, init) {
            return Promise.resolve(
                handler.request(
                    path,
                    body !== undefined ? { method: 'PUT', ...buildJsonInit(body, init) } : { method: 'PUT', ...init },
                ),
            );
        },
        patch(path, body, init) {
            return Promise.resolve(
                handler.request(
                    path,
                    body !== undefined
                        ? { method: 'PATCH', ...buildJsonInit(body, init) }
                        : { method: 'PATCH', ...init },
                ),
            );
        },
        delete(path, init) {
            return Promise.resolve(handler.request(path, { method: 'DELETE', ...init }));
        },
    };
}
