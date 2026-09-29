import { SpanStatusCode, trace, type Attributes, type Span, type Tracer } from '@opentelemetry/api';

export interface TracedOptions {
    /** Attributes of every span. */
    attributes?: Attributes;
    /** The tracer; default the global provider's `iskra` tracer (no spans without an OpenTelemetry SDK). */
    tracer?: Tracer;
}

function fail(span: Span, error: unknown): void {
    span.recordException(error instanceof Error ? error : new Error(String(error)));
    span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.name : 'Error' });
}

/**
 * Wraps `fn` in a span named `name`, by convention `layer.domain.method`
 * (`repo.usuarios.buscar`): the span is the active one while `fn` runs, so
 * the spans started inside (a query, a call to another service) are its
 * children; a throw or a rejection marks it as an error. Without an
 * OpenTelemetry SDK it costs a no-op span.
 *
 * ```ts
 * const buscar = traced('repo.usuarios.buscar', async (id: number) => oracle.one(SQL, { id }));
 * ```
 */
export function traced<A extends unknown[], R>(
    name: string,
    fn: (...args: A) => R,
    options: TracedOptions = {},
): (...args: A) => R {
    return function (this: unknown, ...args: A): R {
        const tracer = options.tracer ?? trace.getTracer('iskra');
        return tracer.startActiveSpan(name, { attributes: options.attributes }, (span) => {
            let result: R;
            try {
                result = fn.apply(this, args);
            } catch (error) {
                fail(span, error);
                span.end();
                throw error;
            }
            if (result instanceof Promise) {
                return result.then(
                    (value) => {
                        span.end();
                        return value;
                    },
                    (error: unknown) => {
                        fail(span, error);
                        span.end();
                        throw error;
                    },
                ) as R;
            }
            span.end();
            return result;
        });
    };
}
