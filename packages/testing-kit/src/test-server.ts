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

function buildJsonInit(body: unknown, base: RequestInit = {}): RequestInit {
    return {
        ...base,
        headers: {
            'content-type': 'application/json',
            ...base.headers,
        },
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
                    body !== undefined
                        ? { method: 'POST', ...buildJsonInit(body, init) }
                        : { method: 'POST', ...init },
                ),
            );
        },
        put(path, body, init) {
            return Promise.resolve(
                handler.request(
                    path,
                    body !== undefined
                        ? { method: 'PUT', ...buildJsonInit(body, init) }
                        : { method: 'PUT', ...init },
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
