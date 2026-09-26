import type { Logger } from '@iskra-bun/core';

export interface MockLogEntry {
    args: unknown[];
}

export interface MockLoggerLogs {
    trace: MockLogEntry[];
    debug: MockLogEntry[];
    info: MockLogEntry[];
    warn: MockLogEntry[];
    error: MockLogEntry[];
    fatal: MockLogEntry[];
}

export interface MockLogger extends Logger {
    logs: MockLoggerLogs;
    reset(): void;
}

function makeRecorder(logs: MockLogEntry[]): (...args: unknown[]) => void {
    return (...args: unknown[]) => {
        logs.push({ args });
    };
}

/**
 * Creates a Logger-compatible mock that captures all log calls into arrays
 * for assertion in tests. No output is written to stdout/stderr.
 *
 * Usage:
 *   const logger = createMockLogger();
 *   logger.info('hello');
 *   expect(logger.logs.info).toHaveLength(1);
 *   logger.reset();
 */
export function createMockLogger(): MockLogger {
    const logs: MockLoggerLogs = {
        trace: [],
        debug: [],
        info: [],
        warn: [],
        error: [],
        fatal: [],
    };

    const mock = {
        logs,
        reset() {
            logs.trace.length = 0;
            logs.debug.length = 0;
            logs.info.length = 0;
            logs.warn.length = 0;
            logs.error.length = 0;
            logs.fatal.length = 0;
        },
        trace: makeRecorder(logs.trace),
        debug: makeRecorder(logs.debug),
        info: makeRecorder(logs.info),
        warn: makeRecorder(logs.warn),
        error: makeRecorder(logs.error),
        fatal: makeRecorder(logs.fatal),
        silent: () => {},
        child(_bindings: Record<string, unknown>, _options?: unknown) {
            // Child loggers share parent capture arrays for simplicity
            return mock as unknown as Logger;
        },
        // Minimal pino.Logger shape — fields tests never touch
        // Every level is enabled, so code that guards a log call with
        // isLevelEnabled() still reaches the capture arrays.
        level: 'trace' as const,
        isLevelEnabled: (_level: string) => true,
        setBindings: (_bindings: Record<string, unknown>) => {},
        flush: (_cb?: (err?: Error) => void) => {},
        bindings: () => ({}) as Record<string, unknown>,
    } as unknown as MockLogger;

    return mock;
}
