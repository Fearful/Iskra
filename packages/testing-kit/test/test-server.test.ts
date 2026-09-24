import { describe, it, expect } from 'bun:test';
import { createTestServer } from '../src';

// Echoes the headers the handler received.
const handler = {
    request: (input: string | Request | URL, init?: RequestInit) => {
        const req = new Request(new URL(String(input), 'http://test'), init);
        return new Response(
            JSON.stringify({ auth: req.headers.get('authorization'), contentType: req.headers.get('content-type') }),
        );
    },
};

describe('createTestServer headers', () => {
    const client = createTestServer(handler);

    it('keeps headers passed as a Headers instance or as tuples with a JSON body', async () => {
        const fromHeaders = await (await client.post('/x', { a: 1 }, { headers: new Headers({ authorization: 'Bearer T' }) })).json();
        const fromTuples = await (await client.put('/x', { a: 1 }, { headers: [['authorization', 'Bearer T']] })).json();
        // Spread into an object literal, a Headers lost its entries and tuples broke the request.
        expect(fromHeaders).toEqual({ auth: 'Bearer T', contentType: 'application/json' });
        expect(fromTuples).toEqual({ auth: 'Bearer T', contentType: 'application/json' });
    });

    it("lets the caller's Content-Type win, whatever its case", async () => {
        const res = await (
            await client.patch('/x', { a: 1 }, { headers: { 'Content-Type': 'application/merge-patch+json' } })
        ).json();
        expect(res.contentType).toBe('application/merge-patch+json');
    });
});
