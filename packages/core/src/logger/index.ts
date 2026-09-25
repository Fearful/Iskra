import pino from 'pino';
import pretty from 'pino-pretty';

/**
 * Field names whose values are replaced with `[REDACTED]`, at any depth. Keys
 * are compared lowercased and without `-` or `_`, so `apiKey`, `api_key` and
 * `X-API-Key` are the same key.
 */
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
    'proxyAuthorization',
    'cookie',
    'setCookie',
    'sessionId',
] as const;

/**
 * Keys ending in one of these are redacted too (normalized the same way):
 * `dbPassword`, `x-api-key`, `x-auth-token`, `AWS_SECRET_ACCESS_KEY`,
 * `webhookSecret`.
 */
const REDACTED_SUFFIXES = ['password', 'passwd', 'secret', 'token', 'apikey', 'secretkey', 'privatekey', 'accesskey'];

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[-_]/g, '');
const SENSITIVE = new Set<string>(REDACTED_KEYS.map(normalizeKey));
const isSensitive = (key: string): boolean => {
    const normalized = normalizeKey(key);
    return SENSITIVE.has(normalized) || REDACTED_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
};
const CENSOR = '[REDACTED]';
/** Objects deeper than this are logged as they are. */
const MAX_DEPTH = 8;
const IN_PROGRESS = Symbol('in progress');

/** The prototype of what pino's err serializer returns (an error's fields, causes included). */
const SERIALIZED_ERROR_PROTO = Object.getPrototypeOf(pino.stdSerializers.err(new Error()));

const isPlainObject = (value: object): boolean => {
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null || proto === SERIALIZED_ERROR_PROTO;
};

/** Query parameter names whose values are masked in messages. */
const SECRET_PARAM = /pass|secret|token|key|sig|auth/i;

/**
 * Passwords in `scheme://user:password@host` and secret-looking query
 * parameters (`?authToken=`, `&X-Amz-Signature=`) of a message: drivers put
 * the connection string in the errors they throw. Bounded quantifiers keep
 * both patterns linear on long input.
 */
function maskCredentials(text: string): string {
    return text
        .replace(/\b([a-z][\w+.-]{0,30}:\/\/[^\s:@/]{0,256}):[^\s@/]{1,256}@/gi, '$1:[REDACTED]@')
        .replace(/([?&])([\w.-]{1,100})=([^&\s'"#]+)/g, (match, sep: string, name: string) =>
            SECRET_PARAM.test(name) ? `${sep}${name}=[REDACTED]` : match,
        );
}

/**
 * An Error as pino's err serializer writes it (type, message and stack with
 * their causes, and its own fields), scrubbed. pino serializes errors after
 * the log formatter runs, so an HTTP client's error (`config.headers
 * .Authorization`) or a Redis error (`command.args` of AUTH) went out as is.
 */
function scrubError(err: Error, depth: number, done: WeakMap<object, unknown>): unknown {
    const serialized = { ...pino.stdSerializers.err(err) } as Record<string, unknown>;
    if (typeof serialized.message === 'string') serialized.message = maskCredentials(serialized.message);
    if (typeof serialized.stack === 'string') serialized.stack = maskCredentials(serialized.stack);
    // Deep: an error keeps the client's objects (axios's `request`, whose
    // `_options.headers` hold the Authorization header), which are class
    // instances that JSON.stringify writes out in full.
    return scrubEntries(serialized, depth, done, true);
}

/**
 * Replaces the value of every sensitive key, at any depth, in a copy of the
 * objects that contain one (the caller's objects are not modified). pino's
 * own `redact` has no recursive wildcard, and listing each key at every depth
 * made logging 14 times slower. Errors are serialized and scrubbed here (see
 * scrubError), and objects with a toJSON() are scrubbed as what it returns;
 * other class instances are left to pino, except inside an error.
 */
function scrub(value: unknown, depth: number, done: WeakMap<object, unknown>, deep = false): unknown {
    if (value === null || typeof value !== 'object' || depth > MAX_DEPTH) return value;
    if (done.has(value)) {
        const result = done.get(value);
        // Still being walked: a cycle, which pino would print as [Circular].
        return result === IN_PROGRESS ? '[Circular]' : result;
    }
    const isError = value instanceof Error;
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    const walk = isError || Array.isArray(value) || isPlainObject(value) || typeof toJSON === 'function' || deep;
    if (!walk) return value;
    done.set(value, IN_PROGRESS);
    let result: unknown;
    if (isError) {
        result = scrubError(value, depth, done);
    } else if (Array.isArray(value)) {
        let copy: unknown[] | undefined;
        value.forEach((item, i) => {
            const scrubbed = scrub(item, depth + 1, done, deep);
            if (scrubbed !== item) (copy ??= value.slice())[i] = scrubbed;
        });
        result = copy ?? value;
    } else if (isPlainObject(value)) {
        result = scrubEntries(value as Record<string, unknown>, depth, done, deep);
    } else if (typeof toJSON === 'function') {
        // Written as its toJSON(), which is what JSON.stringify writes: an axios
        // error's `config.headers` is an AxiosHeaders instance whose
        // Authorization header went out as is.
        result = scrub(toJSON.call(value), depth, done, deep);
    } else {
        // Inside an error: another class instance, as JSON.stringify writes it
        // (its own enumerable fields).
        result = scrubEntries({ ...(value as Record<string, unknown>) }, depth, done, deep);
    }
    done.set(value, result);
    return result;
}

/** An object with its sensitive keys censored and its values scrubbed; a copy if anything changed. */
function scrubEntries(
    value: Record<string, unknown>,
    depth: number,
    done: WeakMap<object, unknown>,
    deep = false,
): Record<string, unknown> {
    let copy: Record<string, unknown> | undefined;
    for (const [key, item] of Object.entries(value)) {
        const scrubbed = isSensitive(key) ? CENSOR : scrub(item, depth + 1, done, deep);
        if (scrubbed !== item) (copy ??= { ...value })[key] = scrubbed;
    }
    // A nested serialized error (pino's prototype) becomes a plain object either way.
    return copy ?? (Object.getPrototypeOf(value) === SERIALIZED_ERROR_PROTO ? { ...value } : value);
}

export const createLogger = (name: string, level: string = 'info') => {
    const isDev = process.env.NODE_ENV !== 'production';
    const options: pino.LoggerOptions = {
        name,
        level,
        formatters: {
            log: (object) => scrub(object, 0, new WeakMap()) as Record<string, unknown>,
        },
        // The formatter above already serialized errors (scrubbed): pino's own
        // err serializer would take that plain object for an error again and
        // rewrite its `type` as "Object".
        serializers: {
            err: (value: unknown) => (value instanceof Error ? scrub(value, 0, new WeakMap()) : value),
        },
        hooks: {
            // Messages are strings the formatter never sees: mask connection
            // string passwords there too, including the message pino takes
            // from an error logged on its own (`logger.error(err)`).
            logMethod(args, method) {
                const masked: unknown[] = args.map((arg) => (typeof arg === 'string' ? maskCredentials(arg) : arg));
                if (masked[0] instanceof Error && typeof masked[1] !== 'string') {
                    masked.splice(1, 0, maskCredentials(masked[0].message));
                }
                return method.apply(this, masked as Parameters<typeof method>);
            },
        },
        redact: {
            paths: ['config.env', '*.data'],
            censor: CENSOR,
        },
    };
    // pino-pretty as an in-process stream, not a `transport`: a transport runs
    // in a worker thread that loads the module by name at runtime, which fails
    // in a `bun build --compile` binary and crashed it at startup.
    const logger = isDev ? pino(options, pretty({ colorize: true })) : pino(options);

    // Bindings (`logger.child({ ... })`) do not go through formatters.log:
    // scrub them here. A child's own children inherit this child().
    type Child = (this: pino.Logger, bindings: pino.Bindings, options?: object) => pino.Logger;
    const child = logger.child as unknown as Child;
    logger.child = function (this: pino.Logger, bindings: pino.Bindings, childOptions?: object) {
        return child.call(this, scrub(bindings, 0, new WeakMap()) as pino.Bindings, childOptions);
    } as unknown as typeof logger.child;
    return logger;
};

export type Logger = pino.Logger;
