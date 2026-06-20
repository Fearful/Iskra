import { describe, it, expect, afterEach } from 'bun:test';
import pino from 'pino';
import { createLogger } from '../src/logger';

// pino exposes its internal symbols for testing purposes
const { streamSym } = (pino as any).symbols as { streamSym: symbol };

describe('createLogger', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
    });

    it('includes pino-pretty transport in development (stream is not stdout)', () => {
        process.env.NODE_ENV = 'development';
        const logger = createLogger('test-dev');
        const stream = (logger as any)[streamSym];
        // pino-pretty runs in a worker thread; the stream is a SonicBoom or worker-backed
        // writable — NOT the raw process.stdout fd-1 object.
        expect(stream).not.toBe(process.stdout);
    });

    it('omits transport in production (stream is stdout)', () => {
        process.env.NODE_ENV = 'production';
        const logger = createLogger('test-prod');
        const stream = (logger as any)[streamSym];
        // Without a custom transport, pino defaults its stream to process.stdout.
        expect(stream).toBeDefined();
        // The underlying fd should be 1 (stdout)
        expect((stream as any).fd).toBe(1);
    });

    it('preserves name and level on the logger', () => {
        process.env.NODE_ENV = 'production';
        const logger = createLogger('my-app', 'warn');
        expect(logger.level).toBe('warn');
    });
});
