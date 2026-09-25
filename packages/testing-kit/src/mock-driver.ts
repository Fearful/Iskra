import type { App, Driver } from '@iskra-bun/core';

export type LifecycleCall = 'init' | 'start' | 'stop';

export interface MockDriverHooks {
    init?: (app: App) => Promise<void> | void;
    start?: () => Promise<void> | void;
    stop?: () => Promise<void> | void;
}

export interface MockDriver extends Driver {
    /** Ordered record of which lifecycle methods were called */
    calls: LifecycleCall[];
    /** Whether init() was called */
    initialized: boolean;
    /** Whether start() was called */
    started: boolean;
    /** Whether stop() was called */
    stopped: boolean;
    /** Reset all recorded state */
    reset(): void;
}

/**
 * Creates a Driver-compatible mock that records every lifecycle call and its
 * order. Optional hooks let tests inject arbitrary behavior or throw errors.
 *
 * Usage:
 *   const driver = createMockDriver({ stop: async () => { throw new Error('boom'); } });
 *   await app.register(driver).start();
 *   expect(driver.calls).toEqual(['init', 'start']);
 */
export function createMockDriver(name: string = 'mock-driver', hooks: MockDriverHooks = {}): MockDriver {
    const calls: LifecycleCall[] = [];

    const driver: MockDriver = {
        name,
        calls,
        initialized: false,
        started: false,
        stopped: false,

        reset() {
            calls.length = 0;
            driver.initialized = false;
            driver.started = false;
            driver.stopped = false;
        },

        async init(app: App) {
            calls.push('init');
            driver.initialized = true;
            if (hooks.init) {
                await hooks.init(app);
            }
        },

        async start() {
            calls.push('start');
            driver.started = true;
            if (hooks.start) {
                await hooks.start();
            }
        },

        async stop() {
            calls.push('stop');
            driver.stopped = true;
            if (hooks.stop) {
                await hooks.stop();
            }
        },
    };

    return driver;
}
