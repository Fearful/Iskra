import { describe, it, expect, mock } from 'bun:test';
import { App } from '../src/app';
import type { Driver } from '../src/types';

describe('App Drivers', () => {
    it('should initialize drivers in order', async () => {
        const app = new App({ name: 'DriverOrder' });
        const sequence: string[] = [];

        const d1: Driver = {
            name: 'D1',
            init: () => { sequence.push('init:D1') },
            start: async () => {
                await new Promise(r => setTimeout(r, 10));
                sequence.push('start:D1')
            }
        };
        const d2: Driver = {
            name: 'D2',
            init: () => { sequence.push('init:D2') },
            start: () => { sequence.push('start:D2') }
        };

        app.register(d1).register(d2);
        await app.start();

        // init runs for every driver, then drivers start one at a time in
        // registration order: D2 waits for D1's slower async start.
        expect(sequence).toEqual(['init:D1', 'init:D2', 'start:D1', 'start:D2']);
    });

    it('should gracefully handle driver start failure', async () => {
        const app = new App({ name: 'DriverFail' });
        const failingDriver: Driver = {
            name: 'BadDriver',
            init: () => { },
            start: async () => { throw new Error('Failed to start path'); }
        };

        app.register(failingDriver);

        // Currently app.start() awaits Promise.all, so it should throw
        await expect(app.start()).rejects.toThrow('Failed to start path');
    });

    it('should continue stopping other drivers if one fails to stop', async () => {
        const app = new App({ name: 'StopFail' });
        const d1Stop = mock(() => { });
        const d2Stop = mock(() => { throw new Error('Stop Error') });

        app.register({ name: 'D1', init: () => { }, stop: d1Stop });
        app.register({ name: 'D2', init: () => { }, stop: d2Stop });

        await app.start();

        // If one fails, does Promise.all fail immediately? 
        // We probably want "best effort" stop.
        // Let's verify current behavior.
        try {
            await app.stop();
        } catch (e) {
            // expected to throw
        }

        expect(d1Stop).toHaveBeenCalled();
        expect(d2Stop).toHaveBeenCalled();
    });
});
