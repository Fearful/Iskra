import { describe, expect, it } from 'bun:test';
import { SpanStatusCode, type Span, type Tracer } from '@opentelemetry/api';
import { traced } from '../src/index';

/** A tracer that records the spans it starts. */
function recorder() {
    const spans: Array<{ name: string; attributes?: unknown; ended: boolean; status?: unknown; exception?: unknown }> =
        [];
    const tracer = {
        startActiveSpan(name: string, options: { attributes?: unknown }, fn: (span: Span) => unknown) {
            const record: (typeof spans)[number] = { name, attributes: options.attributes, ended: false };
            spans.push(record);
            const span = {
                end: () => void (record.ended = true),
                setStatus: (status: unknown) => void (record.status = status),
                recordException: (error: unknown) => void (record.exception = error),
            } as unknown as Span;
            return fn(span);
        },
    } as unknown as Tracer;
    return { tracer, spans };
}

describe('traced()', () => {
    it('runs the function in a span named by its layer, domain and method', async () => {
        const { tracer, spans } = recorder();
        const buscar = traced('repo.usuarios.buscar', async (id: number) => ({ id }), {
            tracer,
            attributes: { 'db.system.name': 'oracle' },
        });
        expect(await buscar(7)).toEqual({ id: 7 });
        expect(spans).toEqual([
            { name: 'repo.usuarios.buscar', attributes: { 'db.system.name': 'oracle' }, ended: true },
        ]);
    });

    it('marks the span as an error on a rejection or a throw, and rethrows', async () => {
        const { tracer, spans } = recorder();
        const failing = traced(
            'svc.pedidos.crear',
            async () => {
                throw new TypeError('boom');
            },
            { tracer },
        );
        await expect(failing()).rejects.toThrow('boom');
        const sync = traced(
            'svc.pedidos.validar',
            () => {
                throw new RangeError('bad');
            },
            { tracer },
        );
        expect(() => sync()).toThrow('bad');

        expect(spans.map((s) => [s.name, s.ended, (s.status as { code: number }).code])).toEqual([
            ['svc.pedidos.crear', true, SpanStatusCode.ERROR],
            ['svc.pedidos.validar', true, SpanStatusCode.ERROR],
        ]);
        expect(spans[0]!.exception).toBeInstanceOf(TypeError);
    });

    it('keeps `this` and returns synchronous values', () => {
        const { tracer } = recorder();
        const repo = {
            prefix: 'u-',
            id: traced(
                'repo.x.id',
                function (this: { prefix: string }, n: number) {
                    return this.prefix + n;
                },
                { tracer },
            ),
        };
        expect(repo.id(3)).toBe('u-3');
    });

    it('works without an SDK (a no-op span)', async () => {
        expect(await traced('noop', async () => 1)()).toBe(1);
    });
});
