// Runs App.init() with `otel` against stand-ins for the optional OpenTelemetry
// packages (not installed here; registered as virtual modules, which is why
// this runs in its own process), then prints as one JSON line what the App
// logged and what it handed to them. OTEL_FIXTURE_ENDPOINT is the endpoint.
import type { App as AppType } from '../../src/app';

const captured: { instrumentations?: Record<string, Record<string, unknown>>; traceUrl?: unknown } = {};
const virtual = (exports: Record<string, unknown>) => () => ({ exports, loader: 'object' as const });

Bun.plugin({
    name: 'fake-opentelemetry',
    setup(build) {
        build.module(
            '@opentelemetry/sdk-node',
            virtual({
                NodeSDK: class {
                    start() {}
                    async shutdown() {}
                },
            }),
        );
        build.module(
            '@opentelemetry/auto-instrumentations-node',
            virtual({
                getNodeAutoInstrumentations: (options: Record<string, Record<string, unknown>>) => {
                    captured.instrumentations = options;
                    return [];
                },
            }),
        );
        build.module(
            '@opentelemetry/exporter-trace-otlp-http',
            virtual({
                OTLPTraceExporter: class {
                    constructor(options: { url: string }) {
                        captured.traceUrl = options.url;
                    }
                },
            }),
        );
        build.module('@opentelemetry/exporter-metrics-otlp-http', virtual({ OTLPMetricExporter: class {} }));
        build.module('@opentelemetry/sdk-metrics', virtual({ PeriodicExportingMetricReader: class {} }));
    },
});

const { App } = (await import('../../src/app')) as { App: typeof AppType };

const app = new App({
    name: 'OtelFixture',
    logger: { level: 'silent' },
    shutdownSignals: false,
    otel: {
        endpoint: process.env.OTEL_FIXTURE_ENDPOINT,
        instrumentations: {
            '@opentelemetry/instrumentation-http': {
                ignoreIncomingRequestHook: () => true,
                requestHook: (span: { setAttribute(key: string, value: string): void }) =>
                    span.setAttribute('app.hook', 'ran'),
            },
        },
    },
});
const logs: Array<{ level: string; fields: unknown; msg: unknown }> = [];
for (const level of ['info', 'warn'] as const) {
    (app.logger as any)[level] = (fields: unknown, msg?: unknown) => logs.push({ level, fields, msg });
}
await app.init();

// An SDK span of an outgoing request, as instrumentation-http releases before
// 0.204 created it (they ignore redactedQueryParams).
const attributes: Record<string, unknown> = {
    'url.full': 'https://api.example.com/v1/items?api_key=K3Y&page=2',
    'http.url': 'https://api.example.com/v1/items?access_token=T0KEN',
};
const span = {
    attributes,
    setAttribute(key: string, value: string) {
        attributes[key] = value;
    },
};
const http = captured.instrumentations!['@opentelemetry/instrumentation-http'];
(http.requestHook as (span: unknown, request: unknown) => void)(span, { setHeader() {} });

console.log(
    JSON.stringify({
        logs,
        traceUrl: captured.traceUrl,
        fsEnabled: captured.instrumentations!['@opentelemetry/instrumentation-fs']?.enabled,
        http: {
            redactedQueryParams: http.redactedQueryParams,
            ignoreIncomingRequestHook: typeof http.ignoreIncomingRequestHook,
        },
        spanAttributes: attributes,
    }),
);
await app.stop();
