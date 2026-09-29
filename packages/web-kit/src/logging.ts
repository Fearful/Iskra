/**
 * Where the Kernel and its features report what they do: startup, fallbacks
 * and errors they handle themselves. `details` is an error or extra data.
 *
 * Pass one as `KernelConfig.logger` (`false` for none). WebPlugin uses the
 * App's logger, so web-kit's messages share the app's format and level.
 */
export interface KernelLogger {
    debug(message: string, details?: unknown): void;
    info(message: string, details?: unknown): void;
    warn(message: string, details?: unknown): void;
    error(message: string, details?: unknown): void;
    /** A logger whose lines carry `bindings` as fields (pino's child), when the logger has fields. */
    child?(bindings: Record<string, unknown>): KernelLogger;
}

/* eslint-disable no-console -- the console sink: writing there is its job. */
const toConsole =
    (write: (...args: unknown[]) => void) =>
    (message: string, details?: unknown): void => {
        if (details === undefined) write(message);
        else write(message, details);
    };

/** The default: the console, as the Kernel always wrote (debug included). */
export const consoleLogger: KernelLogger = {
    debug: toConsole(console.debug),
    info: toConsole(console.log),
    warn: toConsole(console.warn),
    error: toConsole(console.error),
};
/* eslint-enable no-console */

const noop = () => {};

/** `logger: false`: nothing is written. */
export const silentLogger: KernelLogger = { debug: noop, info: noop, warn: noop, error: noop };

/**
 * Adapts a pino-style logger (`logger.info(obj, msg)`, as the App's): details
 * go in the structured object (`err` for errors), not appended to the text.
 */
export interface StructuredLogger {
    debug(obj: object, msg: string): void;
    info(obj: object, msg: string): void;
    warn(obj: object, msg: string): void;
    error(obj: object, msg: string): void;
    child?(bindings: Record<string, unknown>): StructuredLogger;
}

export function fromStructuredLogger(logger: StructuredLogger): KernelLogger {
    const at =
        (level: 'debug' | 'info' | 'warn' | 'error') =>
        (message: string, details?: unknown): void => {
            const obj = details === undefined ? {} : details instanceof Error ? { err: details } : { details };
            logger[level](obj, message);
        };
    const child = logger.child?.bind(logger);
    return {
        debug: at('debug'),
        info: at('info'),
        warn: at('warn'),
        error: at('error'),
        ...(child ? { child: (bindings: Record<string, unknown>) => fromStructuredLogger(child(bindings)) } : {}),
    };
}
