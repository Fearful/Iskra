import type { Feature } from "../types";
import type { Kernel } from "../kernel";
import { httpInstrumentationMiddleware } from "@hono/otel";
import { consoleLogger, type KernelLogger } from "../logging";

export interface OtelTracingConfig {
    serviceName: string;
    serviceVersion?: string;
    captureRequestHeaders?: string[];
    captureResponseHeaders?: string[];
    tracerProvider?: any;
    meterProvider?: any;
    tracer?: any;
    spanNameFactory?: (c: any) => string;
    getTime?: () => number;
}

export class OtelTracingFeature implements Feature {
    name = "otel-tracing";
    private log: KernelLogger = consoleLogger;
    private config: OtelTracingConfig;

    constructor(config: OtelTracingConfig) {
        if (!config.serviceName) {
            throw new Error("serviceName is required for OtelTracingFeature");
        }
        this.config = config;
    }

    async initialize(kernel: Kernel): Promise<void> {
        this.log = kernel.getLogger();
        const app = kernel.getApp();

        const instrumentationConfig: any = {
            serviceName: this.config.serviceName,
        };

        if (this.config.serviceVersion) instrumentationConfig.serviceVersion = this.config.serviceVersion;
        if (this.config.captureRequestHeaders) instrumentationConfig.captureRequestHeaders = this.config.captureRequestHeaders;
        if (this.config.captureResponseHeaders) instrumentationConfig.captureResponseHeaders = this.config.captureResponseHeaders;
        if (this.config.tracerProvider) instrumentationConfig.tracerProvider = this.config.tracerProvider;
        if (this.config.meterProvider) instrumentationConfig.meterProvider = this.config.meterProvider;
        if (this.config.tracer) instrumentationConfig.tracer = this.config.tracer;
        if (this.config.spanNameFactory) instrumentationConfig.spanNameFactory = this.config.spanNameFactory;
        if (this.config.getTime) instrumentationConfig.getTime = this.config.getTime;

        // Register Otel middleware
        app.use("*", httpInstrumentationMiddleware(instrumentationConfig));

        this.log.debug("OpenTelemetry tracing feature initialized");
    }
}
