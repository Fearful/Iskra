import { describe, expect, it, spyOn } from 'bun:test';
import { MockEmailAdapter } from '../src/mock';

describe('MockEmailAdapter', () => {
    it('send() resolves success with a mock- message id', async () => {
        const adapter = new MockEmailAdapter();
        const result = await adapter.send({ to: 'user@example.com', subject: 'Test', text: 'Hello' });

        expect(result.success).toBe(true);
        expect(result.messageId).toContain('mock-');
    });

    it('sendTemplate() resolves success', async () => {
        const adapter = new MockEmailAdapter();
        const result = await adapter.sendTemplate('welcome', 'user@test.com', { name: 'Juan' });

        expect(result.success).toBe(true);
        expect(result.messageId).toContain('mock-');
    });

    it('is silent: writes nothing to stdout/console', async () => {
        const logSpy = spyOn(console, 'log');
        const writeSpy = spyOn(process.stdout, 'write');

        const adapter = new MockEmailAdapter();
        await adapter.send({ to: 'a@example.com', subject: 's', text: 't' });
        await adapter.sendTemplate('tpl', 'b@example.com', { x: 1 });

        expect(logSpy).not.toHaveBeenCalled();
        expect(writeSpy).not.toHaveBeenCalled();

        logSpy.mockRestore();
        writeSpy.mockRestore();
    });
});
