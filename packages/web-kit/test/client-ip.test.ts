import { afterAll, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { getClientIp, type TrustProxy } from '../src/client-ip';

/** A stand-in for the Bun server that `Bun.serve` passes to `fetch` as its 2nd argument. */
const socket = (address: string) => ({ requestIP: () => ({ address, family: 'IPv4', port: 40000 }) });

async function resolve(headers: Record<string, string>, trustProxy?: TrustProxy, env?: unknown) {
    const app = new Hono();
    app.get('/', (c) => c.text(getClientIp(c, trustProxy) ?? '<none>'));
    const res = await app.request('/', { headers }, env);
    return res.text();
}

describe('getClientIp', () => {
    it('uses the socket address and ignores forwarding headers by default', async () => {
        const headers = { 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '7.7.7.7' };
        expect(await resolve(headers, undefined, socket('203.0.113.9'))).toBe('203.0.113.9');
        expect(await resolve(headers, false, socket('203.0.113.9'))).toBe('203.0.113.9');
    });

    it('returns undefined when there is no socket and no trusted proxy', async () => {
        expect(await resolve({ 'x-forwarded-for': '6.6.6.6' })).toBe('<none>');
    });

    it('with one trusted proxy, takes the right-most X-Forwarded-For entry', async () => {
        const proxy = socket('10.0.0.2');
        expect(await resolve({ 'x-forwarded-for': '198.51.100.7' }, true, proxy)).toBe('198.51.100.7');
        // A client-supplied entry to the left of what the proxy appended is ignored.
        expect(await resolve({ 'x-forwarded-for': '6.6.6.6, 198.51.100.7' }, 1, proxy)).toBe('198.51.100.7');
    });

    it('with n trusted proxies, skips n hops from the right', async () => {
        // client -> CDN -> nginx -> app; the attacker prepends a fake entry.
        const headers = { 'x-forwarded-for': '6.6.6.6, 198.51.100.7, 192.0.2.50' };
        expect(await resolve(headers, 2, socket('10.0.0.2'))).toBe('198.51.100.7');
    });

    it('falls back to X-Real-IP, then the socket, behind a trusted proxy', async () => {
        expect(await resolve({ 'x-real-ip': '198.51.100.8' }, true, socket('10.0.0.2'))).toBe('198.51.100.8');
        expect(await resolve({}, true, socket('10.0.0.2'))).toBe('10.0.0.2');
    });

    describe('behind a real Bun.serve', () => {
        const app = new Hono();
        app.get('/', (c) => c.text(getClientIp(c) ?? '<none>'));
        const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: app.fetch });
        afterAll(() => server.stop(true));

        it('reports the peer address even when X-Forwarded-For is spoofed', async () => {
            const res = await fetch(`http://127.0.0.1:${server.port}/`, { headers: { 'x-forwarded-for': '6.6.6.6' } });
            expect(await res.text()).toBe('127.0.0.1');
        });
    });
});
