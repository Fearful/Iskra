import { afterAll, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { clientIpKey, getClientIp, type ClientIpHeader, type TrustProxy } from '../src/client-ip';

/** A stand-in for the Bun server that `Bun.serve` passes to `fetch` as its 2nd argument. */
const socket = (address: string) => ({ requestIP: () => ({ address, family: 'IPv4', port: 40000 }) });

async function resolve(
    headers: Record<string, string>,
    trustProxy?: TrustProxy,
    env?: unknown,
    header?: ClientIpHeader,
) {
    const app = new Hono();
    app.get('/', (c) => c.text(getClientIp(c, trustProxy, header) ?? '<none>'));
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

    it('falls back to the socket, not to X-Real-IP, when X-Forwarded-For is missing', async () => {
        expect(await resolve({ 'x-real-ip': '198.51.100.8' }, true, socket('10.0.0.2'))).toBe('10.0.0.2');
        expect(await resolve({}, true, socket('10.0.0.2'))).toBe('10.0.0.2');
    });

    it('reads only X-Real-IP when it is the configured header, whatever X-Forwarded-For says', async () => {
        // Regression: X-Real-IP was used only when X-Forwarded-For was absent,
        // and the client decides that: behind a proxy that sets X-Real-IP and
        // passes X-Forwarded-For through, a made-up one picked the bucket.
        const proxy = socket('10.0.0.2');
        const real = { 'x-real-ip': '198.51.100.8' };
        expect(await resolve(real, true, proxy, 'x-real-ip')).toBe('198.51.100.8');
        expect(await resolve({ ...real, 'x-forwarded-for': '6.6.6.6' }, true, proxy, 'x-real-ip')).toBe('198.51.100.8');
        // A proxy that appends instead of replacing: its own value is the last one.
        expect(await resolve({ 'x-real-ip': '6.6.6.6, 198.51.100.8' }, true, proxy, 'x-real-ip')).toBe('198.51.100.8');
        expect(await resolve({ 'x-forwarded-for': '6.6.6.6' }, true, proxy, 'x-real-ip')).toBe('10.0.0.2');
        // Still only behind a trusted proxy.
        expect(await resolve(real, false, proxy, 'x-real-ip')).toBe('10.0.0.2');
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

describe('clientIpKey', () => {
    it('keeps IPv4 addresses, also IPv4-mapped ones and with a port', () => {
        expect(clientIpKey('198.51.100.7')).toBe('198.51.100.7');
        expect(clientIpKey('::ffff:198.51.100.7')).toBe('198.51.100.7');
        expect(clientIpKey('::FFFF:c633:6407')).toBe('198.51.100.7');
        expect(clientIpKey('198.51.100.7:51234')).toBe('198.51.100.7');
    });

    it('keys IPv6 addresses by their /64, whatever the notation', () => {
        // Regression: the full address was the key, so one host rotating
        // through its /64 got a fresh budget per address.
        const key = '2001:db8:1:2::/64';
        for (const ip of [
            '2001:db8:1:2::1',
            '2001:DB8:1:2:ffff:ffff:ffff:ffff',
            '2001:0db8:0001:0002:0000:0000:0000:0001',
            '[2001:db8:1:2::9]:443',
            '2001:db8:1:2:a:b:1.2.3.4',
        ]) {
            expect(clientIpKey(ip)).toBe(key);
        }
        expect(clientIpKey('2001:db8:1:3::1')).not.toBe(key);
        expect(clientIpKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
        expect(clientIpKey('::1')).toBe('0:0:0:0::/64');
    });

    it('returns anything that is not an IP as is', () => {
        expect(clientIpKey('unknown')).toBe('unknown');
        expect(clientIpKey('1::2::3')).toBe('1::2::3');
    });
});
