import { OpenAPIHono, createRoute, type RouteConfig } from '@hono/zod-openapi';
import { z } from 'zod';
import type { Driver, App } from '@iskra-bun/core';
import type { RouteOptions } from './router';
import { ErrorCodes } from '@iskra-bun/core';
import { problem, responderOf } from './contract';

export interface WebServerOptions {
    port?: number;
    /**
     * Largest request body accepted, in bytes; bigger ones get 413 before any
     * route runs. Default 16 MiB, as in the Kernel (Bun's own default is 128 MiB).
     */
    maxRequestBodySize?: number;
    routes?: RouteOptions[];
    debug?: boolean;
    openApi?: {
        path: string;
        title: string;
        version: string;
    };
}

const DEFAULT_MAX_REQUEST_BODY_SIZE = 16 * 1024 * 1024;

export class WebDriver implements Driver {
    name = 'WebDriver';
    private app: App | null = null;
    private server: OpenAPIHono;
    private options: WebServerOptions;
    private runningServer: ReturnType<typeof Bun.serve> | null = null;

    constructor(options: WebServerOptions = {}) {
        this.options = options;
        // Answers like the Kernel, by Iskra's response contract: a failed
        // validation, an unknown route and a thrown error.
        this.server = new OpenAPIHono({
            defaultHook: (result, c) => {
                if (!result.success) {
                    return responderOf(c).problem(
                        c,
                        problem(400, {
                            code: ErrorCodes.VALIDATION_ERROR,
                            message: 'Validation Error',
                            details: result.error.flatten(),
                        }),
                    );
                }
            },
        });
        this.server.notFound((c) => responderOf(c).problem(c, problem(404)));
    }

    init(app: App) {
        this.app = app;
        this.setupSecurityHeaders();
        this.setupRoutes();
        this.setupOpenApi();
    }

    // Apply the same standard security headers as the Kernel HTTP stack
    // (web-kit/src/kernel.ts) so the standalone WebDriver server is at parity.
    private setupSecurityHeaders() {
        this.server.use('*', async (c, next) => {
            await next();
            // A header the route set itself (e.g. `X-Frame-Options: DENY`) is kept.
            const set = (name: string, value: string) => {
                if (!c.res.headers.has(name)) c.res.headers.set(name, value);
            };
            set('X-Frame-Options', 'SAMEORIGIN');
            set('X-Content-Type-Options', 'nosniff');
            set('Referrer-Policy', 'strict-origin-when-cross-origin');
        });
    }

    private setupOpenApi() {
        if (this.options.openApi) {
            this.server.doc(this.options.openApi.path, {
                openapi: '3.0.0',
                info: {
                    version: this.options.openApi.version,
                    title: this.options.openApi.title,
                },
            });
        }
    }

    private setupRoutes() {
        if (!this.options.routes) return;

        for (const route of this.options.routes) {
            // Map simple RouteOptions to OpenAPI RouteConfig
            // We assume JSON for body

            // zod-openapi validates Zod v3 and v4 schemas at run time; its
            // types only name its own Zod, hence the casts to RouteConfig below.
            const routeConfig: Record<string, unknown> & { request: Record<string, unknown> } = {
                method: route.method.toLowerCase(),
                path: route.path,
                tags: route.doc?.tags,
                summary: route.doc?.summary,
                description: route.doc?.description,
                request: {},
                responses: {
                    200: {
                        description: 'Successful response',
                        content: {
                            'application/json': {
                                schema: z.any(), // We don't enforce response schema yet
                            },
                        },
                    },
                    500: {
                        description: 'Internal Server Error',
                    },
                },
            };

            if (route.schema?.body) {
                routeConfig.request.body = {
                    content: {
                        'application/json': {
                            schema: route.schema.body,
                        },
                    },
                    // Validated whatever the Content-Type: when not required,
                    // a text/plain or untyped body skipped validation and the
                    // handler got an empty object.
                    required: true,
                };
            }
            if (route.schema?.query) {
                routeConfig.request.query = route.schema.query;
            }
            if (route.schema?.params) {
                routeConfig.request.params = route.schema.params;
            }

            const openApiRoute = createRoute(routeConfig as unknown as RouteConfig);

            this.server.openapi(openApiRoute, async (c) => {
                if (!this.app) throw new Error('App not initialized');

                // zod-openapi put the data its validation accepted in c.req.valid().
                // Bound: valid() reads the request's validated data through `this`.
                const valid = (c.req.valid as (target: 'json' | 'query') => unknown).bind(c.req);
                const webCtx = {
                    raw: c,
                    body: route.schema?.body ? valid('json') : undefined,
                    query: route.schema?.query ? valid('query') : undefined,
                    params: c.req.param(),
                    app: this.app,
                };

                try {
                    const result = await route.handler(webCtx);
                    if (result instanceof Response) return result;
                    return c.json(result);
                } catch (err) {
                    // By the contract, like the Kernel: an HttpError keeps its
                    // status, anything else is a 500 whose message (it may embed
                    // connection strings or other secrets) stays in the log.
                    const responder = responderOf(c);
                    const found = responder.toProblem(err, c);
                    if (found.status >= 500) this.app.logger.error({ err, route: route.path }, 'Route handler failed');
                    return responder.problem(c, found, err);
                }
            });
        }
    }

    start() {
        const port = this.options.port || 3000;
        this.app?.logger.info(`Starting WebServer on port ${port}...`);

        // Bun.serve works with OpenAPIHono just like Hono
        this.runningServer = Bun.serve({
            fetch: this.server.fetch,
            port,
            // Bodies are read whole (c.req.json()); without a cap an anonymous
            // client could hold 128 MiB per request in memory.
            maxRequestBodySize: this.options.maxRequestBodySize ?? DEFAULT_MAX_REQUEST_BODY_SIZE,
        });
    }

    stop() {
        if (this.runningServer) {
            this.runningServer.stop();
        }
        this.app?.logger.info('WebServer stopped');
    }
}
