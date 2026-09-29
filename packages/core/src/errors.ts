export const ErrorCodes = {
    // General
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    NOT_INITIALIZED: 'NOT_INITIALIZED',
    ADAPTER_ERROR: 'ADAPTER_ERROR',

    // Config
    CONFIG_INVALID: 'CONFIG_INVALID',
    CONFIG_MISSING: 'CONFIG_MISSING',

    // Driver
    DRIVER_INIT_FAILED: 'DRIVER_INIT_FAILED',
    DRIVER_START_FAILED: 'DRIVER_START_FAILED',
    DRIVER_STOP_FAILED: 'DRIVER_STOP_FAILED',
    DRIVER_NOT_FOUND: 'DRIVER_NOT_FOUND',

    // Plugin
    PLUGIN_INSTALL_FAILED: 'PLUGIN_INSTALL_FAILED',

    // Lifecycle
    LIFECYCLE_START_FAILED: 'LIFECYCLE_START_FAILED',
    LIFECYCLE_STOP_FAILED: 'LIFECYCLE_STOP_FAILED',

    // HTTP
    BAD_REQUEST: 'BAD_REQUEST',
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    NOT_FOUND: 'NOT_FOUND',
    METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
    CONFLICT: 'CONFLICT',
    PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
    UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    RATE_LIMITED: 'RATE_LIMITED',
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
    TIMEOUT: 'TIMEOUT',

    // Data
    DATABASE_ERROR: 'DATABASE_ERROR',
    CONNECTION_ERROR: 'CONNECTION_ERROR',
    QUERY_ERROR: 'QUERY_ERROR',
    MIGRATION_ERROR: 'MIGRATION_ERROR',
    CACHE_ERROR: 'CACHE_ERROR',

    // Storage / Upload
    STORAGE_ERROR: 'STORAGE_ERROR',
    FILE_UPLOAD_ERROR: 'FILE_UPLOAD_ERROR',
    FILE_NOT_FOUND: 'FILE_NOT_FOUND',

    // Worker
    QUEUE_ERROR: 'QUEUE_ERROR',
    JOB_ERROR: 'JOB_ERROR',

    // Socket
    SOCKET_CONNECTION_ERROR: 'SOCKET_CONNECTION_ERROR',
    SOCKET_MESSAGE_ERROR: 'SOCKET_MESSAGE_ERROR',
} as const;

/**
 * Every error code, as keys: Iskra's own (`ErrorCodes`) and the ones an app
 * adds by merging into this interface, which `ErrorCode` then accepts:
 *
 * ```ts
 * declare module '@iskra-bun/core' {
 *     interface ErrorCodeRegistry {
 *         ORDER_LOCKED: true;
 *     }
 * }
 * throw new HttpError(423, 'The order is being edited', { code: 'ORDER_LOCKED' });
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- extended by declaration merging
export interface ErrorCodeRegistry extends Record<(typeof ErrorCodes)[keyof typeof ErrorCodes], true> {}

export type ErrorCode = keyof ErrorCodeRegistry & string;

export interface IskraErrorOptions {
    code: ErrorCode;
    cause?: Error;
    context?: Record<string, unknown>;
}

/**
 * Clase base para todos los errores del framework Iskra.
 * Soporta encadenamiento de errores vía `cause` y metadata arbitraria en `context`.
 */
export class IskraError extends Error {
    public readonly code: ErrorCode;
    public readonly context: Record<string, unknown>;

    constructor(message: string, options: IskraErrorOptions) {
        super(message, { cause: options.cause });
        this.name = 'IskraError';
        this.code = options.code;
        this.context = options.context ?? {};
    }

    toJSON() {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            context: this.context,
            ...(this.cause instanceof Error ? { cause: this.cause.message } : {}),
        };
    }
}

// ─── Config Errors ───────────────────────────────────────────────────────────

export class ConfigError extends IskraError {
    constructor(message: string, options?: { cause?: Error; context?: Record<string, unknown> }) {
        super(message, { code: ErrorCodes.CONFIG_INVALID, ...options });
        this.name = 'ConfigError';
    }
}

// ─── Driver Errors ───────────────────────────────────────────────────────────

export class DriverError extends IskraError {
    constructor(message: string, options?: { code?: ErrorCode; cause?: Error; context?: Record<string, unknown> }) {
        super(message, {
            code: options?.code ?? ErrorCodes.DRIVER_INIT_FAILED,
            cause: options?.cause,
            context: options?.context,
        });
        this.name = 'DriverError';
    }
}

// ─── Plugin Errors ───────────────────────────────────────────────────────────

export class PluginError extends IskraError {
    constructor(message: string, options?: { cause?: Error; context?: Record<string, unknown> }) {
        super(message, { code: ErrorCodes.PLUGIN_INSTALL_FAILED, ...options });
        this.name = 'PluginError';
    }
}

// ─── Lifecycle Errors ────────────────────────────────────────────────────────

export class LifecycleError extends IskraError {
    public readonly failures: PromiseRejectedResult[];

    constructor(
        message: string,
        options: { failures?: PromiseRejectedResult[]; cause?: Error; context?: Record<string, unknown> },
    ) {
        super(message, { code: ErrorCodes.LIFECYCLE_STOP_FAILED, cause: options.cause, context: options.context });
        this.name = 'LifecycleError';
        this.failures = options.failures ?? [];
    }
}
