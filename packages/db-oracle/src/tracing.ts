import { SpanKind, SpanStatusCode, trace, type Tracer } from '@opentelemetry/api';
import type { QueryEnd } from './driver';

/** The driver's hook registration: an OracleDriver. */
interface Hookable {
    onQuery(hook: (sql: string, binds: unknown) => unknown): () => void;
}

export interface OracleTracingOptions {
    /** Default the global provider's `@iskra-bun/db-oracle` tracer. */
    tracer?: Tracer;
    /**
     * Put the SQL in `db.query.text`, as written: binds by name or position,
     * never their values. Default true; false when the SQL itself is sensitive.
     */
    queryText?: boolean;
}

/**
 * A span per statement, commit and rollback (`oracle SELECT`, a CLIENT span
 * with `db.system.name`, `db.operation.name`, `db.query.text` and
 * `db.response.returned_rows`), the child of the span active when it ran,
 * such as `traced()`'s; a failure records its error code. Returns what stops it.
 */
export function instrumentOracle(driver: Hookable, options: OracleTracingOptions = {}): () => void {
    return driver.onQuery((sql) => {
        const tracer = options.tracer ?? trace.getTracer('@iskra-bun/db-oracle');
        const operation = /^\s*([A-Za-z]+)/.exec(sql)?.[1]?.toUpperCase() ?? 'QUERY';
        const span = tracer.startSpan(`oracle ${operation}`, {
            kind: SpanKind.CLIENT,
            attributes: {
                'db.system.name': 'oracle.db',
                'db.system': 'oracle',
                'db.operation.name': operation,
                ...(options.queryText === false ? {} : { 'db.query.text': sql }),
            },
        });
        return (end: QueryEnd) => {
            if (end.rows !== undefined) span.setAttribute('db.response.returned_rows', end.rows);
            if (end.error) {
                span.recordException(end.error);
                span.setAttribute('error.type', end.error.errorCode ?? end.error.code);
                span.setStatus({ code: SpanStatusCode.ERROR, message: end.error.errorCode ?? end.error.code });
            }
            span.end();
        };
    });
}
