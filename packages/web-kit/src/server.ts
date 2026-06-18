import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import type { Driver, App } from '@iskra-bun/core';
import type { RouteOptions } from './router';

export interface WebServerOptions {
    port?: number;
    routes?: RouteOptions[];
    debug?: boolean;
    openApi?: {
        path: string;
        title: string;
        version: string;
    };
}

export class WebDriver implements Driver {
    name = 'WebDriver';
    private app: App | null = null;
    private server: OpenAPIHono;
    private options: WebServerOptions;
    private runningServer: any;

    constructor(options: WebServerOptions = {}) {
        this.options = options;
        this.server = new OpenAPIHono();
    }

    init(app: App) {
        this.app = app;
        this.setupRoutes();
        this.setupOpenApi();
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

            const routeConfig: any = {
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
                                schema: z.any() // We don't enforce response schema yet
                            }
                        }
                    },
                    500: {
                        description: 'Internal Server Error'
                    }
                }
            };

            if (route.schema?.body) {
                routeConfig.request.body = {
                    content: {
                        'application/json': {
                            schema: route.schema.body
                        }
                    }
                };
            }
            if (route.schema?.query) {
                routeConfig.request.query = route.schema.query;
            }
            if (route.schema?.params) {
                routeConfig.request.params = route.schema.params;
            }

            const openApiRoute = createRoute(routeConfig);

            this.server.openapi(openApiRoute, async (c) => {
                if (!this.app) throw new Error('App not initialized');

                const webCtx = {
                    raw: c,
                    // Hono/zod-openapi puts validated data in c.req.valid('json') etc similar to validator middleware
                    body: route.schema?.body ? (c as any).req.valid('json') : undefined,
                    query: route.schema?.query ? (c as any).req.valid('query') : undefined,
                    params: c.req.param(),
                    app: this.app
                };

                try {
                    const result = await route.handler(webCtx);
                    if (result instanceof Response) return result;
                    return c.json(result);
                } catch (err: any) {
                    this.app.logger.error(err);
                    return c.json({ error: err.message }, 500);
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
            port
        });
    }

    stop() {
        if (this.runningServer) {
            this.runningServer.stop();
        }
        this.app?.logger.info('WebServer stopped');
    }
}
