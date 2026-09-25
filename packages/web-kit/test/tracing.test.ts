import { describe, it, expect, afterEach } from 'bun:test';
import {
    context,
    propagation,
    trace,
    TraceFlags,
    type Context as OtelContext,
    type TextMapPropagator,
    type Tracer,
} from '@opentelemetry/api';
import { Kernel } from '../src/kernel';
import { OtelTracingFeature, type OtelTracingConfig } from '../src/features/tracing';

/** A tracer that records how @hono/otel starts each span (no SDK is installed here). */
function recordingTracer() {
    const spans: Array<{ name: string; attributes: Record<string, unknown>; parent: OtelContext }> = [];
    const span = {
        setAttribute() {
            return span;
        },
        setStatus() {
            return span;
        },
        updateName() {
            return span;
        },
        recordException() {},
        end() {},
        isRecording: () => true,
        spanContext: () => ({ traceId: '0'.repeat(32), spanId: '0'.repeat(16), traceFlags: 1 }),
    };
    const tracer = {
        startSpan: () => span,
        startActiveSpan: (name: string, options: any, parent: OtelContext, fn: (s: unknown) => unknown) => {
            spans.push({ name, attributes: { ...options.attributes }, parent });
            return fn(span);
        },
    } as unknown as Tracer;
    return { tracer, spans };
}

/** Reads a W3C `traceparent` header (the SDK's propagator is not installed here). */
const traceparent: TextMapPropagator = {
    inject() {},
    extract(ctx, carrier: any) {
        const [, traceId, spanId] = String(carrier.traceparent ?? '').split('-');
        if (!traceId || !spanId) return ctx;
        return trace.setSpanContext(ctx, { traceId, spanId, traceFlags: TraceFlags.SAMPLED, isRemote: true });
    },
    fields: () => ['traceparent'],
};

async function tracedApp(config: Partial<OtelTracingConfig> = {}) {
    const { tracer, spans } = recordingTracer();
    const kernel = new Kernel({ logger: false });
    kernel.registerFeature(new OtelTracingFeature({ serviceName: 'test', tracer, ...config }));
    await kernel.initialize();
    kernel.getApp().all('*', (c) => c.text('ok'));
    return { app: kernel.getApp(), spans };
}

afterEach(() => {
    propagation.disable();
});

describe('OtelTracingFeature', () => {
    it('exports url.full without the tokens of the request', async () => {
        const { app, spans } = await tracedApp();

        await app.request('/api/sso/verify-email?token=EMAIL-TOKEN&callbackURL=%2Fhome');
        await app.request('/api/sso/reset-password/RESET-TOKEN?callbackURL=%2Freset');
        await app.request('/items?api_key=K3Y&page=2');

        const urls = spans.map((s) => s.attributes['url.full']);
        expect(urls).toEqual([
            'http://localhost/api/sso/verify-email?token=REDACTED&callbackURL=%2Fhome',
            'http://localhost/api/sso/reset-password/REDACTED?callbackURL=%2Freset',
            'http://localhost/items?api_key=REDACTED&page=2',
        ]);
    });

    it('takes the list of parameters to redact from redactedQueryParams', async () => {
        const { app, spans } = await tracedApp({ redactedQueryParams: ['sid'] });

        await app.request('/a?sid=1&token=2');
        expect(spans[0].attributes['url.full']).toBe('http://localhost/a?sid=REDACTED&token=2');
    });

    it("continues the client's trace unless ignoreIncomingTraceContext is set", async () => {
        propagation.setGlobalPropagator(traceparent);
        const headers = { traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01` };

        const trusting = await tracedApp();
        await trusting.app.request('/', { headers });
        expect(trace.getSpanContext(trusting.spans[0].parent)?.traceId).toBe('a'.repeat(32));

        const edge = await tracedApp({ ignoreIncomingTraceContext: true });
        await edge.app.request('/', { headers });
        expect(trace.getSpanContext(edge.spans[0].parent)).toBeUndefined();
        expect(edge.spans[0].parent).toBe(context.active());
    });
});
