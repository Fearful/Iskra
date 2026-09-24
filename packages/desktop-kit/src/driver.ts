import type { App, Driver } from '@iskra-bun/core';

/**
 * Experimental placeholder. It hooks into the App lifecycle but does not wrap
 * any Tauri API yet (windows, IPC, menus); it only logs. See the README.
 */
export class DesktopDriver implements Driver {
    name = 'DesktopDriver';
    private app: App | null = null;

    async init(app: App) {
        this.app = app;
    }

    async start() {
        this.app?.logger.warn(
            'DesktopDriver is an experimental placeholder: it does not integrate with Tauri yet (no windows, IPC or menus)',
        );
    }
}
