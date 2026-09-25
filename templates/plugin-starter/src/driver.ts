import type { App, Driver } from '@iskra-bun/core';

export interface MyPluginConfig {
    option?: string;
}

export class MyPluginDriver implements Driver {
    name = 'MyPluginDriver';
    private app: App | null = null;

    constructor(private config: MyPluginConfig = {}) {}

    async init(app: App) {
        this.app = app;
        this.app.logger.info(`Initializing MyPluginDriver with option: ${this.config.option}`);
    }

    async start() {
        this.app?.logger.info('MyPluginDriver started');
    }

    async stop() {
        this.app?.logger.info('MyPluginDriver stopped');
    }

    // Custom method exposed by this driver
    doSomething() {
        this.app?.logger.info('MyPluginDriver is doing something!');
    }
}
