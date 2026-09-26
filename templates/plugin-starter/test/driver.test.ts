import { describe, expect, it, spyOn } from 'bun:test';
import { App } from '@iskra-bun/core';
import { MyPluginDriver } from '../src/index';

describe('MyPluginDriver', () => {
    it('runs its lifecycle inside an App and exposes its methods', async () => {
        const app = new App({ name: 'PluginTest', logger: { level: 'error' }, shutdownSignals: false });
        const driver = new MyPluginDriver({ option: 'value' });
        const info = spyOn(app.logger, 'info');

        app.register(driver);
        await app.start();
        expect(info).toHaveBeenCalledWith('Initializing MyPluginDriver with option: value');
        expect(info).toHaveBeenCalledWith('MyPluginDriver started');

        driver.doSomething();
        expect(info).toHaveBeenCalledWith('MyPluginDriver is doing something!');

        await app.stop();
        expect(info).toHaveBeenCalledWith('MyPluginDriver stopped');
    });
});
