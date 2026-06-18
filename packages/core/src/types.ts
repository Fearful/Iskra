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

export interface Context<T = any> {
    app: App;
    logger: Logger;
    payload: T;
    reply(data: any): void;
}

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
    processes?: Record<string, ProcessConfig>;
    socket?: {
        enabled: boolean;
        port?: number; // If different from web
        adapter?: 'bun' | 'socket.io';
    };
    kv?: {
        driver: 'memory' | 'redis' | 'libsql';
        connection?: any;
    };
    db?: {
        driver: 'postgres' | 'mysql' | 'sqlite' | 'libsql';
        url: string;
        authToken?: string;
    };
    [key: string]: any;
}

export interface ProcessConfig {
    command: string;
    args?: string[];
    mode?: 'daemon' | 'oneshot' | 'stdio';
    restartOnCrash?: boolean;
    maxRestarts?: number;
    restartCooldown?: number;
    env?: Record<string, string>;
}
