import { describe, expect, test } from 'bun:test';
import { SpanStatusCode, type Tracer } from '@opentelemetry/api';
import { instrumentOracle } from '../src/tracing';
import { oraError, startedDriver } from './fakes';

/** A tracer that records the spans it starts. */
function recorder() {
    const spans: Array<{ name: string; attributes: Record<string, unknown>; ended: boolean; status?: unknown }> = [];
    const tracer = {
        startSpan(name: string, options: { attributes: Record<string, unknown> }) {
            const record = { name, attributes: { ...options.attributes }, ended: false, status: undefined as unknown };
            spans.push(record);
            return {
                setAttribute: (key: string, value: unknown) => void (record.attributes[key] = value),
                recordException: () => {},
                setStatus: (status: unknown) => void (record.status = status),
                end: () => void (record.ended = true),
            };
        },
    } as unknown as Tracer;
    return { tracer, spans };
}

describe('instrumentOracle()', () => {
    test('starts a span per statement, commit and rollback, next to the other hooks', async () => {
        const { driver, pool } = await startedDriver();
        const { tracer, spans } = recorder();
        const seen: string[] = [];
        driver.setOnQuery((sql) => void seen.push(sql));
        const stop = instrumentOracle(driver, { tracer });

        pool.respond = () => ({ rows: [{ N: 1 }, { N: 2 }] });
        await driver.query('SELECT n FROM t WHERE id = :id', { id: 'secret-id' });
        await driver.transaction((tx) => tx.execute('UPDATE t SET n = 1'));

        expect(spans.map((s) => s.name)).toEqual(['oracle SELECT', 'oracle UPDATE', 'oracle COMMIT']);
        expect(spans[0]!.attributes).toEqual({
            'db.system.name': 'oracle.db',
            'db.system': 'oracle',
            'db.operation.name': 'SELECT',
            'db.query.text': 'SELECT n FROM t WHERE id = :id',
            'db.response.returned_rows': 2,
        });
        expect(JSON.stringify(spans)).not.toContain('secret-id');
        expect(spans.every((s) => s.ended)).toBe(true);
        expect(seen).toContain('SELECT n FROM t WHERE id = :id');

        stop();
        await driver.query('SELECT 2 FROM dual');
        expect(spans).toHaveLength(3);
    });

    test('marks a failed statement with its error code, and leaves the SQL out when asked', async () => {
        const { driver, pool } = await startedDriver();
        const { tracer, spans } = recorder();
        instrumentOracle(driver, { tracer, queryText: false });
        pool.respond = () => oraError(942, 'table or view does not exist');
        await driver.query('SELECT * FROM missing').catch(() => {});

        expect(spans[0]!.attributes['db.query.text']).toBeUndefined();
        expect(spans[0]!.attributes['error.type']).toBe('ORA-00942');
        expect(spans[0]!.status).toEqual({ code: SpanStatusCode.ERROR, message: 'ORA-00942' });
    });
});
