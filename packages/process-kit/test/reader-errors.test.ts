import { describe, it, expect, mock } from 'bun:test';
import { App } from '@iskra-bun/core';
import { ProcessManager } from '../src/spawner';

/**
 * RED tests for the "swallowed reader errors" finding
 * (spawner.ts readStdOut :112 and readStdErr :247).
 *
 * Today both readers wrap their loop in `catch (err) { /* empty *\/ }`, so a
 * thrown stream error vanishes silently and operators have no way to know a
 * pipe broke mid-read.
 *
 * Desired FIXED behavior: the catch blocks must log via
 * `app.logger.debug({ err, name }, ...)` so a thrown error is observable and
 * distinguishable from a normal end-of-stream (`done: true`).
 *
 * Strategy: white-box. We hand the private readStdOut/readStdErr a fake
 * ReadableStream whose reader.read() THROWS, and assert app.logger.debug was
 * called with the error and the process name.
 */

function makeManager() {
    const app = new App({ name: 'ReaderErrTest', logger: { level: 'error' } });
    const pm = new ProcessManager();
    pm.init(app);
    return { app, pm };
}

/** A stream whose getReader().read() rejects, simulating a broken pipe. */
function makeThrowingStream(err: Error) {
    return {
        getReader() {
            return {
                read: () => Promise.reject(err),
            };
        },
    } as unknown as ReadableStream;
}

/** A stream that ends normally on the first read (done: true). */
function makeEmptyStream() {
    let first = true;
    return {
        getReader() {
            return {
                read: () => {
                    if (first) {
                        first = false;
                        return Promise.resolve({ done: true, value: undefined });
                    }
                    return Promise.resolve({ done: true, value: undefined });
                },
            };
        },
    } as unknown as ReadableStream;
}

describe('ProcessManager readStdOut – error visibility', () => {
    it('logs a debug entry with the error and process name when the reader throws', async () => {
        const { app, pm } = makeManager();
        const debugLog = mock(() => {});
        app.logger.debug = debugLog as any;

        const boom = new Error('stdout pipe exploded');
        await (pm as any).readStdOut('outproc', makeThrowingStream(boom));

        expect(debugLog).toHaveBeenCalled();
        const [arg0] = debugLog.mock.calls[0] as any[];
        expect(arg0.err).toBe(boom);
        expect(arg0.name).toBe('outproc');
    });

    it('does NOT log an error on a clean end-of-stream', async () => {
        const { app, pm } = makeManager();
        const debugLog = mock(() => {});
        app.logger.debug = debugLog as any;

        await (pm as any).readStdOut('cleanproc', makeEmptyStream());

        // Normal end-of-stream must NOT be reported as an error.
        expect(debugLog).not.toHaveBeenCalled();
    });
});

describe('ProcessManager readStdErr – error visibility', () => {
    it('logs a debug entry with the error and process name when the reader throws', async () => {
        const { app, pm } = makeManager();
        const debugLog = mock(() => {});
        app.logger.debug = debugLog as any;

        const boom = new Error('stderr pipe exploded');
        await (pm as any).readStdErr('errproc', makeThrowingStream(boom));

        expect(debugLog).toHaveBeenCalled();
        const [arg0] = debugLog.mock.calls[0] as any[];
        expect(arg0.err).toBe(boom);
        expect(arg0.name).toBe('errproc');
    });

    it('does NOT log an error on a clean end-of-stream', async () => {
        const { app, pm } = makeManager();
        const debugLog = mock(() => {});
        app.logger.debug = debugLog as any;

        await (pm as any).readStdErr('cleanerr', makeEmptyStream());

        expect(debugLog).not.toHaveBeenCalled();
    });
});
