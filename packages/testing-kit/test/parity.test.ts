import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { casesFromHar, compareAll, compareCase, formatReport } from '@iskra-bun/testing-kit/parity';

/** The Go service's answers, as bytes. */
function legacy() {
    const app = new Hono();
    app.get(
        '/api/users/1',
        () =>
            new Response('{"data":{"id":1,"name":"Ana","note":"\\u003cb\\u003e"},"timestamp":"2024-01-01"}', {
                headers: { 'content-type': 'application/json' },
            }),
    );
    app.get('/api/users/2', (c) => c.json({ message: 'Not Found' }, 404));
    app.get('/api/list', (c) =>
        c.json({
            recordsTotal: 3,
            data: [
                { id: 1, at: 'x' },
                { id: 2, at: 'y' },
            ],
        }),
    );
    return app;
}

/** Its replacement. */
function candidate() {
    const app = new Hono();
    app.get('/api/users/1', (c) => c.json({ timestamp: '2025-06-06', data: { name: 'Ana', id: 1, note: '<b>' } }));
    app.get('/api/users/2', (c) => c.json({ error: 'Not Found' }, 404));
    app.get('/api/list', (c) =>
        c.json({
            recordsTotal: 3,
            data: [
                { id: 1, at: 'z' },
                { id: 3, at: 'w' },
            ],
        }),
    );
    return app;
}

const targets = { legacy: legacy(), candidate: candidate() };

describe('compareCase()', () => {
    it('compares JSON as values, key order aside, leaving the ignored paths out', async () => {
        const result = await compareCase({ path: '/api/users/1' }, { ...targets, ignorePaths: ['$.timestamp'] });
        expect(result.differences).toEqual([]);
        expect(result.equal).toBe(true);
    });

    it('names each difference by its JSON path', async () => {
        const missing = await compareCase({ path: '/api/users/2' }, targets);
        expect(missing.differences).toEqual(['$.message: only in legacy', '$.error: only in candidate']);

        const list = await compareCase({ path: '/api/list' }, { ...targets, ignorePaths: ['$.data[*].at'] });
        expect(list.differences).toEqual(['$.data[1].id: 2 ≠ 3']);
    });

    it("compares bytes in exact mode, reading Go's HTML escapes when asked", async () => {
        const exact = await compareCase({ path: '/api/users/1' }, { ...targets, mode: 'exact', goHtmlEscape: true });
        expect(exact.differences[0]).toStartWith('body differs at character 2');
        const same = new Hono().get('/x', () => new Response('{"a":"\\u003c"}'));
        const js = new Hono().get('/x', () => new Response('{"a":"<"}'));
        expect(
            (await compareCase({ path: '/x' }, { legacy: same, candidate: js, mode: 'exact', goHtmlEscape: true }))
                .equal,
        ).toBe(true);
        expect((await compareCase({ path: '/x' }, { legacy: same, candidate: js, mode: 'exact' })).equal).toBe(false);
    });

    it('compares the status and the chosen headers, a missing header included', async () => {
        const a = new Hono().delete('/x', (c) => c.body(null, 200));
        const b = new Hono().delete('/x', (c) => c.json({}, 204 as never));
        await expect(compareCase({ method: 'DELETE', path: '/x' }, { legacy: a, candidate: b })).rejects.toThrow(
            'set allowWrite',
        );
        const result = await compareCase(
            { method: 'DELETE', path: '/x' },
            { legacy: a, candidate: b, allowWrite: true },
        );
        expect(result.differences).toContain('status: 200 ≠ 204');
        expect(result.differences.some((d) => d.startsWith('header content-type: null'))).toBe(true);
    });
});

describe('compareAll() and friends', () => {
    it('reports every case', async () => {
        const results = await compareAll([{ name: 'user', path: '/api/users/1' }, { path: '/api/users/2' }], {
            ...targets,
            ignorePaths: ['$.timestamp'],
        });
        expect(formatReport(results)).toBe(
            '✓ user\n✗ GET /api/users/2\n    $.message: only in legacy\n    $.error: only in candidate\n\n1/2 equal',
        );
    });

    it('reads the requests of a HAR capture', () => {
        const har = {
            log: {
                entries: [
                    { request: { method: 'GET', url: 'http://old/api/users?page=2' } },
                    { request: { method: 'POST', url: 'http://old/api/users', postData: { text: '{"name":"Ana"}' } } },
                ],
            },
        };
        expect(casesFromHar(har)).toEqual([
            { method: 'GET', path: '/api/users?page=2' },
            { method: 'POST', path: '/api/users', body: { name: 'Ana' } },
        ]);
    });
});
