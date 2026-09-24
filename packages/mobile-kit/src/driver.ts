import type { Driver, App } from '@iskra-bun/core';

/**
 * Experimental placeholder. It hooks into the App lifecycle but does not
 * integrate with any mobile platform yet (deep links, push, native listeners);
 * it only logs. See the README.
 */
export class MobileDriver implements Driver {
    name = 'MobileDriver';
    private app: App | null = null;

    async init(app: App) {
        this.app = app;
    }

    async start() {
        this.app?.logger.warn(
            'MobileDriver is an experimental placeholder: it does not integrate with any mobile platform yet',
        );
    }

    async stop() {}
}
