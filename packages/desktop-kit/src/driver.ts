import type { App, Driver } from '@iskra-bun/core';

export class DesktopDriver implements Driver {
    name = 'DesktopDriver';
    private app: App | null = null;

    // In a real implementation this would wrap Tauri APIs
    // import { invoke } from '@tauri-apps/api';

    async init(app: App) {
        this.app = app;
    }

    async start() {
        this.app?.logger.info('DesktopDriver started (Tauri bridge active)');
    }
}
