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

// The optional OTel packages are loaded by specifier, untyped; these are the
// parts of them used here.
type Ctor<T = unknown> = new (options: Record<string, unknown>) => T;
interface OtelSdkNode {
    NodeSDK: Ctor<{ start(): void; shutdown(): Promise<void> }>;
}
interface OtelAutoInstrumentations {
    getNodeAutoInstrumentations(overrides: Record<string, unknown>): unknown;
}
interface OtelTraceExporter {
    OTLPTraceExporter: Ctor;
}
interface OtelMetricExporter {
    OTLPMetricExporter: Ctor;
}
interface OtelSdkMetrics {
    PeriodicExportingMetricReader: Ctor;
}
interface OtelSemconv {
    ATTR_SERVICE_NAME?: string;
    ATTR_SERVICE_VERSION?: string;
}
/** `@opentelemetry/resources`: 2.x exports resourceFromAttributes(), 1.x the Resource class. */
export interface OtelResourcesModule {
    resourceFromAttributes?: (attributes: Record<string, string>) => unknown;
    Resource?: new (attributes: Record<string, string>) => unknown;
}

/** Import an optional module by specifier; the indirection keeps tsc from resolving it. */
function importOptional<T>(specifier: string): Promise<T> {
    return import(specifier) as Promise<T>;
}

const DEFAULT_ENDPOINT = 'http://localhost:4318';
const HTTP_INSTRUMENTATION = '@opentelemetry/instrumentation-http';

/**
 * Query parameters whose values are exported as REDACTED in span URLs (see
 * redactUrl). Names are compared without case, `-` or `_`.
 */
export const SECRET_QUERY_PARAMS: readonly string[] = [
    'token',
    'access_token',
    'refresh_token',
    'id_token',
    'auth_token',
    'session_token',
    'api_key',
    'key',
    'secret',
    'client_secret',
    'password',
    'passwd',
    'code',
    'state',
    'ticket',
    'otp',
    'jwt',
    'signature',
    'sig',
    'X-Amz-Signature',
    'X-Amz-Credential',
    'X-Amz-Security-Token',
    'AWSAccessKeyId',
    'X-Goog-Signature',
    'X-Goog-Credential',
];

const normalizeParam = (name: string): string => name.toLowerCase().replace(/[-_]/g, '');

function decodeParam(name: string): string {
    try {
        return decodeURIComponent(name.replace(/\+/g, ' '));
    } catch {
        return name;
    }
}

/**
 * `url` (absolute, or a path) with the value of each query parameter named in
 * `params` replaced by REDACTED, the rest kept as it was. Telemetry exported
 * URLs as they were requested: `?api_key=`, `?access_token=`, a presigned
 * URL's signature.
 */
export function redactUrl(url: string, params: readonly string[] = SECRET_QUERY_PARAMS): string {
    const start = url.indexOf('?');
    if (start === -1 || params.length === 0) return url;
    const names = new Set(params.map(normalizeParam));
    const hash = url.indexOf('#', start);
    const end = hash === -1 ? url.length : hash;
    let redacted = false;
    const query = url
        .slice(start + 1, end)
        .split('&')
        .map((pair) => {
            const eq = pair.indexOf('=');
            if (eq === -1 || !names.has(normalizeParam(decodeParam(pair.slice(0, eq))))) return pair;
            redacted = true;
            return `${pair.slice(0, eq)}=REDACTED`;
        })
        .join('&');
    return redacted ? url.slice(0, start + 1) + query + url.slice(end) : url;
}

/** The URL attributes of an HTTP span, in the stable and the older semantic conventions. */
const URL_ATTRIBUTES = ['url.full', 'url.query', 'http.url', 'http.target'];

/** Rewrites the URL attributes of a recording SDK span (it has `attributes`). */
function redactSpanUrls(span: unknown, params: readonly string[]): void {
    const { attributes, setAttribute } = (span ?? {}) as {
        attributes?: Record<string, unknown>;
        setAttribute?: (key: string, value: string) => unknown;
    };
    if (!attributes || typeof setAttribute !== 'function') return;
    for (const key of URL_ATTRIBUTES) {
        const value = attributes[key];
        if (typeof value !== 'string') continue;
        // url.query is the query string alone, without its "?".
        const redacted = key === 'url.query' ? redactUrl(`?${value}`, params).slice(1) : redactUrl(value, params);
        if (redacted !== value) setAttribute.call(span, key, redacted);
    }
}

/**
 * The options initOtel() passes to getNodeAutoInstrumentations(): the app's
 * `instrumentations` over Iskra's defaults. The HTTP instrumentation redacts
 * SECRET_QUERY_PARAMS unless `redactedQueryParams` / `redactedQueryParamsServer`
 * are set (instrumentation-http 0.204 / 0.222 and later apply them itself;
 * for older releases a requestHook rewrites the span's URL attributes, before
 * the app's own requestHook runs).
 */
export function autoInstrumentationOptions(config: OtelConfig): Record<string, unknown> {
    const http: Record<string, unknown> = { ...config.instrumentations?.[HTTP_INSTRUMENTATION] };
    const list = (value: unknown) => (Array.isArray(value) ? (value as string[]) : undefined);
    const client = list(http.redactedQueryParams) ?? SECRET_QUERY_PARAMS;
    const server = list(http.redactedQueryParamsServer) ?? SECRET_QUERY_PARAMS;
    const appHook = http.requestHook;
    return {
        '@opentelemetry/instrumentation-fs': { enabled: false },
        ...config.instrumentations,
        [HTTP_INSTRUMENTATION]: {
            ...http,
            redactedQueryParams: client,
            redactedQueryParamsServer: server,
            requestHook: (span: unknown, request: unknown) => {
                // A ClientRequest (outgoing) has setHeader(); an IncomingMessage does not.
                const outgoing = typeof (request as { setHeader?: unknown } | null)?.setHeader === 'function';
                redactSpanUrls(span, outgoing ? client : server);
                if (typeof appHook === 'function') appHook(span, request);
            },
        },
    };
}

/** Hosts spans may reach in clear text: this machine, a private network, or a name that only resolves inside one. */
function isPrivateHost(hostname: string): boolean {
    const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (host.includes(':')) return host === '::1' || /^f[cd]/.test(host);
    return (
        !host.includes('.') ||
        /\.(localhost|local|internal)$/.test(host) ||
        /^(127|10)\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
}

/**
 * The OTLP endpoint as it is safe to log, its origin (the path, query or
 * userinfo can carry an API key), and whether spans travel to it in clear
 * text beyond this machine and its private network.
 */
export function describeOtelEndpoint(config: OtelConfig): { origin: string; plaintext: boolean } {
    try {
        const url = new URL(config.endpoint || DEFAULT_ENDPOINT);
        return { origin: url.origin, plaintext: url.protocol === 'http:' && !isPrivateHost(url.hostname) };
    } catch {
        return { origin: '(invalid URL)', plaintext: false };
    }
}

/**
 * Builds a Resource with whichever API the installed `@opentelemetry/resources`
 * provides: 2.x only exports `resourceFromAttributes()` (`Resource` is a type
 * there, so `new Resource()` throws), 1.x exports the `Resource` class.
 */
export function createResource(resources: OtelResourcesModule, attributes: Record<string, string>): unknown {
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
            importOptional<OtelSdkNode>(OTEL_MODULES.sdkNode),
            importOptional<OtelAutoInstrumentations>(OTEL_MODULES.autoInstrumentations),
            importOptional<OtelTraceExporter>(OTEL_MODULES.traceExporter),
            importOptional<OtelMetricExporter>(OTEL_MODULES.metricExporter),
            importOptional<OtelSdkMetrics>(OTEL_MODULES.sdkMetrics),
            importOptional<OtelResourcesModule>(OTEL_MODULES.resources),
            importOptional<OtelSemconv>(OTEL_MODULES.semconv),
        ]);

        const serviceName = config.serviceName || appName;
        const endpoint = config.endpoint || DEFAULT_ENDPOINT;

        const resource = createResource(resources, {
            [semconv.ATTR_SERVICE_NAME ?? 'service.name']: serviceName,
            [semconv.ATTR_SERVICE_VERSION ?? 'service.version']: config.serviceVersion || '0.1.0',
            'deployment.environment': config.environment || process.env.NODE_ENV || 'development',
            ...config.resourceAttributes,
        });

        const instrumentationOverrides = autoInstrumentationOptions(config);

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
        if (
            e?.code === 'ERR_MODULE_NOT_FOUND' ||
            e?.code === 'MODULE_NOT_FOUND' ||
            e?.message?.includes('Cannot find')
        ) {
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
