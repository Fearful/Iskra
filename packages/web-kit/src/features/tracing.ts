import type { Feature } from '../types';
import type { Kernel } from '../kernel';
import { httpInstrumentationMiddleware } from '@hono/otel';
import { consoleLogger, type KernelLogger } from '../logging';

/** @hono/otel's options, as is. */
type HttpInstrumentationConfig = NonNullable<Parameters<typeof httpInstrumentationMiddleware>[0]>;

/** @hono/otel's instrumentation options, with `serviceName` required. */
export type OtelTracingConfig = HttpInstrumentationConfig & { serviceName: string };

export class OtelTracingFeature implements Feature {
    name = 'otel-tracing';
    private log: KernelLogger = consoleLogger;
    private config: OtelTracingConfig;

    constructor(config: OtelTracingConfig) {
        if (!config.serviceName) {
            throw new Error('serviceName is required for OtelTracingFeature');
        }
        this.config = config;
    }

    async initialize(kernel: Kernel): Promise<void> {
        this.log = kernel.getLogger();
        const app = kernel.getApp();

        // Register Otel middleware
        app.use('*', httpInstrumentationMiddleware({ ...this.config }));

        this.log.debug('OpenTelemetry tracing feature initialized');
    }
}
