import type { Driver, App } from '@iskra-bun/core';

export class MobileDriver implements Driver {
    name = 'MobileDriver';
    private app: App | null = null;

    async init(app: App) {
        this.app = app;
        this.app.logger.info('Initializing Mobile Driver...');
    }

    async start() {
        // Here we would set up listeners for mobile-specific events
        // e.g. deep links, push notifications, etc.
        this.app?.logger.info('Mobile Driver started.');
    }

    async stop() {
        this.app?.logger.info('Mobile Driver stopped.');
    }
}
