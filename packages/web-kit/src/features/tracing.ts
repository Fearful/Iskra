import type { Feature } from '../types';
import type { Kernel } from '../kernel';
import { httpInstrumentationMiddleware } from '@hono/otel';
import {
    context,
    trace,
    type Context as OtelContext,
    type Span,
    type SpanOptions,
    type Tracer,
    type TracerProvider,
} from '@opentelemetry/api';
import { SECRET_QUERY_PARAMS, redactUrl } from '@iskra-bun/core';
import { consoleLogger, type KernelLogger } from '../logging';

/** @hono/otel's options, as is. */
type HttpInstrumentationConfig = NonNullable<Parameters<typeof httpInstrumentationMiddleware>[0]>;

/** @hono/otel's instrumentation options, with `serviceName` required, and what this feature adds. */
export type OtelTracingConfig = HttpInstrumentationConfig & {
    serviceName: string;
    /**
     * Query parameters whose values `url.full` carries as REDACTED, compared
     * without case, `-` or `_`. Default: SECRET_QUERY_PARAMS from
     * @iskra-bun/core (`token`, `api_key`, `code`, `state`…); `[]` keeps them.
     */
    redactedQueryParams?: string[];
    /**
     * Start a new trace for every request instead of continuing the one in
     * the client's `traceparent` header (its `baggage` is dropped too). For a
     * service that faces the internet: a client can otherwise force its
     * requests to be sampled and attach them to a trace of its choosing.
     * Default false.
     */
    ignoreIncomingTraceContext?: boolean;
};

/** better-auth's password reset link carries the token in the path: `/reset-password/<token>`. */
const TOKEN_IN_PATH = /(\/reset-password\/)[^/?#]+/;

/**
 * A tracer that starts spans with a redacted `url.full` and, when asked,
 * without the remote parent extracted from the request. @hono/otel sets
 * `url.full` to `c.req.url` as it is: `?token=` of an email verification
 * link, the reset-password token, `?api_key=` went to the collector.
 */
function guardedTracer(tracer: Tracer, redact: (url: string) => string, ignoreParent: boolean): Tracer {
    const options = (spanOptions: SpanOptions = {}): SpanOptions => {
        const url = spanOptions.attributes?.['url.full'];
        if (typeof url !== 'string') return spanOptions;
        return { ...spanOptions, attributes: { ...spanOptions.attributes, 'url.full': redact(url) } };
    };
    const parent = (ctx?: OtelContext): OtelContext => (ignoreParent || !ctx ? context.active() : ctx);
    return {
        startSpan: (name, spanOptions, ctx) => tracer.startSpan(name, options(spanOptions), parent(ctx)),
        // (name, fn), (name, options, fn) or (name, options, context, fn)
        startActiveSpan: ((name: string, ...args: unknown[]) => {
            const fn = args.pop() as (span: Span) => unknown;
            const [spanOptions, ctx] = args as [SpanOptions | undefined, OtelContext | undefined];
            return tracer.startActiveSpan(name, options(spanOptions), parent(ctx), fn);
        }) as Tracer['startActiveSpan'],
    };
}

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

        const { redactedQueryParams, ignoreIncomingTraceContext, ...options } = this.config;
        const params = redactedQueryParams ?? SECRET_QUERY_PARAMS;
        const redact = (url: string) => redactUrl(url.replace(TOKEN_IN_PATH, '$1REDACTED'), params);
        const guard = (tracer: Tracer) => guardedTracer(tracer, redact, ignoreIncomingTraceContext === true);
        // @hono/otel takes the tracer from `tracer`, else from `tracerProvider`, else the global provider.
        const provider: TracerProvider = options.tracerProvider ?? trace.getTracerProvider();
        const tracing = options.tracer
            ? { tracer: guard(options.tracer) }
            : { tracerProvider: { getTracer: (...args) => guard(provider.getTracer(...args)) } as TracerProvider };

        // Register Otel middleware
        app.use('*', httpInstrumentationMiddleware({ ...options, ...tracing }));

        this.log.debug('OpenTelemetry tracing feature initialized');
    }
}
