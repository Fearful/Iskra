import { describe, it, expect, mock } from 'bun:test';
import { App } from '../src/app';
import type { Driver } from '../src/types';

describe('App Core', () => {
    it('should initialize with default config', () => {
        const app = new App({ name: 'TestApp' });
        expect(app.config.name).toBe('TestApp');
    });

    it('should register and initialize drivers', async () => {
        const app = new App({ name: 'TestApp' });
        const mockDriver: Driver = {
            name: 'MockDriver',
            init: mock(() => { }),
            start: mock(async () => { }),
            stop: mock(async () => { })
        };

        app.register(mockDriver);
        await app.start();

        expect(mockDriver.init).toHaveBeenCalled();
        expect(mockDriver.start).toHaveBeenCalled();

        await app.stop();
        expect(mockDriver.stop).toHaveBeenCalled();
    });

    it('should handle events', async () => {
        const app = new App({ name: 'EventTest' });
        const handler = mock((ctx) => {
            expect(ctx.payload).toBe('hello');
        });

        app.on('test.event', handler);
        app.emit('test.event', 'hello');

        // Wait for event loop
        await new Promise(r => setTimeout(r, 10));
        expect(handler).toHaveBeenCalled();
    });
});
