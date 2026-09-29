import type { App, Driver } from '@iskra-bun/core';
import { Hono } from 'hono';
import { Kernel } from './kernel';
import type { Feature, KernelConfig } from './types';
import { fromStructuredLogger } from './logging';
import { Router } from './group-router';

export interface WebPluginConfig extends KernelConfig {
    /** The app's routes: a `Router` (groups, priorities, unmatched) or a Hono app mounted at "/". */
    router?: Router | Hono;
    features?: Feature[];
}

export class WebPlugin implements Driver {
    name = 'WebPlugin';
    private app: App | null = null;
    private kernel: Kernel;
    private router?: Router | Hono;
    /** Whether the config chose a logger (or `false`): otherwise the App's is used. */
    private ownLogger: boolean;

    constructor(config: WebPluginConfig = {}) {
        const { router, features, ...kernelConfig } = config;
        this.kernel = new Kernel(kernelConfig);
        this.router = router;
        this.ownLogger = config.logger !== undefined;

        if (features) {
            for (const feature of features) {
                this.kernel.registerFeature(feature);
            }
        }
    }

    async init(app: App) {
        this.app = app;
        // web-kit's messages then share the app's format, level and sinks.
        if (!this.ownLogger) this.kernel.setLogger(fromStructuredLogger(app.logger));
        await this.kernel.initialize();

        mountRoutes(this.kernel, this.router);
    }

    getHonoApp(): Hono {
        return this.kernel.getApp();
    }

    async start() {
        this.app?.logger.info(`Starting WebPlugin...`);
        // We let the kernel start or we start it manually using Bun
        // Kernel.start() does Bun.serve.
        await this.kernel.start();
    }

    async stop() {
        await this.kernel.shutdown();
        this.app?.logger.info('WebPlugin stopped');
    }
}

/**
 * Adds an app's routes to an initialized Kernel, after every feature's
 * middleware: a Router is compiled onto the Kernel's app, a Hono app is
 * mounted at "/".
 */
export function mountRoutes(kernel: Kernel, router: Router | Hono | undefined): void {
    if (router instanceof Router) router.compile(kernel.getApp());
    else if (router) kernel.getApp().route('/', router);
}
