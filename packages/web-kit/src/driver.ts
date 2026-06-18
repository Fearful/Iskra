import type { App, Driver } from '@iskra-bun/core';
import { Hono } from 'hono';
import { Kernel } from './kernel';
import type { Feature, KernelConfig } from './types';

export interface WebPluginConfig extends KernelConfig {
    router?: Hono;
    features?: Feature[];
}

export class WebPlugin implements Driver {
    name = 'WebPlugin';
    private app: App | null = null;
    private kernel: Kernel;
    private runningServer: any;
    private router?: Hono;

    constructor(config: WebPluginConfig = {}) {
        const { router, features, ...kernelConfig } = config;
        this.kernel = new Kernel(kernelConfig);
        this.router = router;

        if (features) {
            for (const feature of features) {
                this.kernel.registerFeature(feature);
            }
        }
    }

    async init(app: App) {
        this.app = app;
        await this.kernel.initialize();

        if (this.router) {
            this.kernel.getApp().route('/', this.router);
        }
    }

    getHonoApp(): Hono {
        return this.kernel.getApp();
    }

    async start() {
        this.app?.logger.info(`Starting WebPlugin...`);
        // We let the kernel start or we start it manually using Bun
        // Kernel.start() does Bun.serve.
        await this.kernel.start();
        this.runningServer = true; // Placeholder, Kernel.start() might block or not return server instance directly
    }

    async stop() {
        await this.kernel.shutdown();
        this.app?.logger.info('WebPlugin stopped');
    }
}
