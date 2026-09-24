/**
 * OpenTelemetry SDK initialization for Iskra apps.
 *
 * All OTel packages are dynamic-imported so they remain optional peer deps.
 * Apps that don't set `config.otel` never load this code.
 *
 * The module specifiers are held in variables rather than passed as string
 * literals to `import()`. This stops `tsc` from statically resolving the
 * optional `@opentelemetry/*` packages at compile time, so the module
 * typechecks cleanly even when those peer deps are absent. At runtime the
 * imports still resolve normally, and a missing package degrades to a clear,
 * actionable error instead of an unhandled module-resolution failure.
 */
import type { OtelConfig } from './types';

let sdkInstance: { shutdown(): Promise<void> } | null = null;

/** Optional OTel package specifiers, indirected so tsc does not resolve them statically. */
const OTEL_MODULES = {
    sdkNode: '@opentelemetry/sdk-node',
    autoInstrumentations: '@opentelemetry/auto-instrumentations-node',
    traceExporter: '@opentelemetry/exporter-trace-otlp-http',
    metricExporter: '@opentelemetry/exporter-metrics-otlp-http',
    sdkMetrics: '@opentelemetry/sdk-metrics',
    resources: '@opentelemetry/resources',
    semconv: '@opentelemetry/semantic-conventions',
} as const;

/** Import an optional module by specifier; the indirection keeps tsc from resolving it. */
function importOptional(specifier: string): Promise<any> {
    return import(specifier);
}

/**
 * Builds a Resource with whichever API the installed `@opentelemetry/resources`
 * provides: 2.x only exports `resourceFromAttributes()` (`Resource` is a type
 * there, so `new Resource()` throws), 1.x exports the `Resource` class.
 */
export function createResource(resources: any, attributes: Record<string, string>): any {
    if (typeof resources?.resourceFromAttributes === 'function') {
        return resources.resourceFromAttributes(attributes);
    }
    if (typeof resources?.Resource === 'function') {
        return new resources.Resource(attributes);
    }
    throw new Error(
        '[iskra/otel] Unsupported @opentelemetry/resources: it exports neither resourceFromAttributes() nor Resource',
    );
}

/**
 * Initialize the OpenTelemetry NodeSDK with OTLP exporters.
 * Must be called before any drivers start so auto-instrumentation can patch libraries.
 */
export async function initOtel(config: OtelConfig, appName: string): Promise<void> {
    if (sdkInstance) return; // Already initialized

    try {
        const [
            { NodeSDK },
            { getNodeAutoInstrumentations },
            { OTLPTraceExporter },
            { OTLPMetricExporter },
            { PeriodicExportingMetricReader },
            resources,
            semconv,
        ] = await Promise.all([
            importOptional(OTEL_MODULES.sdkNode),
            importOptional(OTEL_MODULES.autoInstrumentations),
            importOptional(OTEL_MODULES.traceExporter),
            importOptional(OTEL_MODULES.metricExporter),
            importOptional(OTEL_MODULES.sdkMetrics),
            importOptional(OTEL_MODULES.resources),
            importOptional(OTEL_MODULES.semconv),
        ]);

        const serviceName = config.serviceName || appName;
        const endpoint = config.endpoint || 'http://localhost:4318';

        const resource = createResource(resources, {
            [semconv.ATTR_SERVICE_NAME ?? 'service.name']: serviceName,
            [semconv.ATTR_SERVICE_VERSION ?? 'service.version']: config.serviceVersion || '0.1.0',
            'deployment.environment': config.environment || process.env.NODE_ENV || 'development',
            ...config.resourceAttributes,
        });

        const instrumentationOverrides: Record<string, unknown> = {
            '@opentelemetry/instrumentation-fs': { enabled: false },
            ...config.instrumentations,
        };

        const sdk = new NodeSDK({
            resource,
            traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
            metricReader: new PeriodicExportingMetricReader({
                exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
                exportIntervalMillis: config.metricIntervalMs ?? 60_000,
            }),
            instrumentations: [getNodeAutoInstrumentations(instrumentationOverrides)],
        });

        sdk.start();
        sdkInstance = sdk;
    } catch (err) {
        // Provide a clear error when OTel packages are not installed
        const e = err as { code?: string; message?: string } | null;
        if (e?.code === 'ERR_MODULE_NOT_FOUND' || e?.code === 'MODULE_NOT_FOUND' || e?.message?.includes('Cannot find')) {
            throw new Error(
                `[iskra/otel] OpenTelemetry packages are not installed. ` +
                `Install them with: bun add @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node ` +
                `@opentelemetry/exporter-trace-otlp-http @opentelemetry/exporter-metrics-otlp-http ` +
                `@opentelemetry/sdk-metrics @opentelemetry/resources @opentelemetry/semantic-conventions`,
            );
        }
        throw err;
    }
}

/**
 * Gracefully shut down the OTel SDK, flushing any pending spans/metrics.
 */
export async function shutdownOtel(): Promise<void> {
    if (sdkInstance) {
        await sdkInstance.shutdown();
        sdkInstance = null;
    }
}
