import pino from 'pino';
import pretty from 'pino-pretty';

/** Field names whose values are replaced with `[REDACTED]`. */
const REDACTED_KEYS = [
    'password',
    'pass',
    'passwd',
    'apiKey',
    'apiSecret',
    'token',
    'authToken',
    'accessToken',
    'refreshToken',
    'idToken',
    'secret',
    'clientSecret',
    'secretKey',
    'privateKey',
    'authorization',
    'cookie',
] as const;

const SENSITIVE = new Set<string>(REDACTED_KEYS.map((key) => key.toLowerCase()));
const CENSOR = '[REDACTED]';
/** Objects deeper than this are logged as they are. */
const MAX_DEPTH = 8;
const IN_PROGRESS = Symbol('in progress');

const isPlainObject = (value: object): boolean => {
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
};

/**
 * Replaces the value of every sensitive key, at any depth, in a copy of the
 * objects that contain one (the caller's objects are not modified). pino's
 * own `redact` has no recursive wildcard, and listing each key at every depth
 * made logging 14 times slower. Class instances (errors, dates, buffers) are
 * left to pino's serializers.
 */
function scrub(value: unknown, depth: number, done: WeakMap<object, unknown>): unknown {
    if (value === null || typeof value !== 'object' || depth > MAX_DEPTH) return value;
    if (done.has(value)) {
        const result = done.get(value);
        // Still being walked: a cycle, which pino would print as [Circular].
        return result === IN_PROGRESS ? '[Circular]' : result;
    }
    if (!Array.isArray(value) && !isPlainObject(value)) return value;
    done.set(value, IN_PROGRESS);
    let copy: unknown[] | Record<string, unknown> | undefined;
    if (Array.isArray(value)) {
        value.forEach((item, i) => {
            const scrubbed = scrub(item, depth + 1, done);
            if (scrubbed !== item) ((copy as unknown[] | undefined) ??= value.slice())[i] = scrubbed;
        });
    } else {
        for (const [key, item] of Object.entries(value)) {
            const scrubbed = SENSITIVE.has(key.toLowerCase()) ? CENSOR : scrub(item, depth + 1, done);
            if (scrubbed !== item) ((copy as Record<string, unknown> | undefined) ??= { ...value })[key] = scrubbed;
        }
    }
    done.set(value, copy ?? value);
    return copy ?? value;
}

export const createLogger = (name: string, level: string = 'info') => {
    const isDev = process.env.NODE_ENV !== 'production';
    const options: pino.LoggerOptions = {
        name,
        level,
        formatters: {
            log: (object) => scrub(object, 0, new WeakMap()) as Record<string, unknown>,
        },
        redact: {
            paths: ['config.env', '*.data'],
            censor: CENSOR,
        },
    };
    // pino-pretty as an in-process stream, not a `transport`: a transport runs
    // in a worker thread that loads the module by name at runtime, which fails
    // in a `bun build --compile` binary and crashed it at startup.
    return isDev ? pino(options, pretty({ colorize: true })) : pino(options);
};

export type Logger = pino.Logger;
