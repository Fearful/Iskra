import type { App } from './app';
import type { Logger } from 'pino';

export interface Driver {
    name: string;
    init(app: App): Promise<void> | void;
    start?(): Promise<void> | void;
    stop?(): Promise<void> | void;
}

export interface Plugin {
    name: string;
    install(app: App): Promise<void> | void;
}

/** What an `app.on()` handler receives; `payload` is the emitted value. */
export interface Context<T = unknown> {
    app: App;
    logger: Logger;
    payload: T;
    /** Emits `<event>:reply` with `data`. */
    reply(data: unknown): void;
}

/**
 * What each kit shares through `app.context`, by key, so `app.context.get('db')`
 * is typed. Kits add their keys with declaration merging, and so can an app:
 *
 * ```ts
 * declare module '@iskra-bun/core' {
 *     interface AppContextRegistry {
 *         bridge: DesktopBridge;
 *     }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- filled by declaration merging
export interface AppContextRegistry {}

/**
 * The payload of each app event, by name, so `app.on('process:exit', ...)`
 * and `app.emit(...)` are typed. Kits add their events with declaration
 * merging, and so can an app (as with AppContextRegistry).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- filled by declaration merging
export interface AppEvents {}

export interface OtelConfig {
    /** Defaults to true when otel config is present */
    enabled?: boolean;
    /** OTLP endpoint URL. Defaults to http://localhost:4318 */
    endpoint?: string;
    /** Overrides app name for the service.name resource attribute */
    serviceName?: string;
    /** Service version resource attribute */
    serviceVersion?: string;
    /** Deployment environment resource attribute. Defaults to NODE_ENV */
    environment?: string;
    /** Metric export interval in ms. Defaults to 60000 */
    metricIntervalMs?: number;
    /** Additional resource attributes */
    resourceAttributes?: Record<string, string>;
    /** Auto-instrumentation overrides (passed to getNodeAutoInstrumentations) */
    instrumentations?: Record<string, { enabled?: boolean }>;
}

export interface AppConfig {
    name: string;
    debug?: boolean;
    logger?: {
        level?: string;
    };
    otel?: OtelConfig;
    /**
     * Signals that trigger a graceful `stop()` and exit. Default
     * `['SIGTERM', 'SIGINT']` (none under NODE_ENV=test); `false` disables.
     */
    shutdownSignals?: string[] | false;
    /** Max time for a signal-triggered stop before forcing exit(1). Default 10000. */
    shutdownTimeoutMs?: number;
    processes?: Record<string, ProcessConfig>;
    socket?: {
        enabled: boolean;
        port?: number; // If different from web
        adapter?: 'bun' | 'socket.io';
    };
    kv?: {
        driver: 'memory' | 'redis';
        /** Redis: a URL string, ioredis options, or ioredis options with `url`. */
        connection?: string | Record<string, unknown>;
    };
    db?: {
        driver: 'postgres' | 'mysql' | 'sqlite' | 'libsql';
        url: string;
        authToken?: string;
    };
    /** Sections of other kits or of the app; read them with their own type. */
    [key: string]: unknown;
}

export interface RestartBackoffConfig {
    /** Initial delay in ms before the first restart. Default: 1000 */
    initialMs?: number;
    /** Maximum delay cap in ms. Default: 30000 */
    maxMs?: number;
    /** Multiplier applied to the delay after each restart. Default: 2 */
    factor?: number;
}

export interface ProcessConfig {
    command: string;
    args?: string[];
    mode?: 'daemon' | 'oneshot' | 'stdio';
    restartOnCrash?: boolean;
    maxRestarts?: number;
    restartCooldown?: number;
    /** Variables set for the child, over the ones it inherits (see `inheritEnv`). */
    env?: Record<string, string>;
    /**
     * Which of the app's environment variables the child inherits. Default
     * `false`: a minimal set without secrets (PATH, HOME, locale, TZ, temp
     * dir, NODE_ENV…). A list adds those names to it; `true` passes them all
     * (DATABASE_URL, AUTH_SECRET, cloud keys…).
     */
    inheritEnv?: boolean | string[];
    /**
     * `stdio` mode: bytes `send()` lets wait for a child that is not reading
     * its stdin; past this it refuses messages (returns false). Default 8 MiB.
     */
    maxPendingStdinBytes?: number;
    /** Exponential backoff settings for restarts. Defaults to 1000 ms flat (no backoff). */
    restartBackoff?: RestartBackoffConfig;
}
