import type { Context } from 'hono';
import { getConnInfo } from 'hono/bun';
import { isIPv4, isIPv6 } from 'node:net';

/**
 * How many reverse proxies sit in front of the app, for resolving the client IP.
 *
 * - `false` / `0` (default): ignore forwarding headers and use the socket
 *   address. Any client can put anything in `X-Forwarded-For`, so trusting it
 *   without a proxy lets them pick their own rate-limit bucket.
 * - `true`: shorthand for `1` (a single proxy such as nginx or a load balancer).
 * - `n`: `n` trusted proxies. The client IP is the address `n` hops from the
 *   right of `X-Forwarded-For` + socket address — each proxy appends the
 *   address it received the request from, so entries further left than that
 *   were written by the client and are ignored.
 */
export type TrustProxy = boolean | number;

/**
 * The header the trusted proxies put the client address in:
 *
 * - `'x-forwarded-for'` (default): each proxy appends the address it received
 *   the request from (nginx: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`).
 * - `'x-real-ip'`: the proxy sets it to the client address
 *   (nginx: `proxy_set_header X-Real-IP $remote_addr`).
 */
export type ClientIpHeader = 'x-forwarded-for' | 'x-real-ip';

function trustedHops(trustProxy: TrustProxy | undefined): number {
    if (trustProxy === true) return 1;
    if (typeof trustProxy === 'number' && trustProxy > 0) return Math.floor(trustProxy);
    return 0;
}

function socketAddress(c: Context): string | undefined {
    try {
        return getConnInfo(c).remote.address || undefined;
    } catch {
        // Not served by Bun.serve (e.g. `app.request()` in tests): no socket.
        return undefined;
    }
}

/** The entries of a comma-separated header, trimmed. */
function headerList(c: Context, name: string): string[] {
    return (c.req.header(name) ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * Resolves the client's IP address, or `undefined` when it cannot be
 * determined (no socket and no trusted forwarding header).
 *
 * Behind trusted proxies only `header` is read. X-Real-IP used to be the
 * fallback when X-Forwarded-For was missing, and the client decides whether it
 * is: behind a proxy that sets only X-Real-IP, a made-up X-Forwarded-For on
 * each request picked a new rate-limit bucket.
 */
export function getClientIp(
    c: Context,
    trustProxy?: TrustProxy,
    header: ClientIpHeader = 'x-forwarded-for',
): string | undefined {
    const socket = socketAddress(c);
    const hops = trustedHops(trustProxy);
    if (hops === 0) return socket;

    if (header === 'x-real-ip') {
        // One value, set by the nearest proxy: its own is the last one even if
        // it appends to the client's instead of replacing it.
        return headerList(c, 'x-real-ip').pop() || socket;
    }

    // The last hop is the socket peer (the nearest proxy). Without a socket we
    // still count it as one hop so the result matches production.
    const chain = [...headerList(c, 'x-forwarded-for'), socket ?? ''];
    return chain[Math.max(0, chain.length - 1 - hops)] || undefined;
}

/** The eight 16-bit groups of a valid IPv6 address (a trailing dotted IPv4 is the last two). */
function ipv6Groups(address: string): number[] {
    const parse = (part: string) =>
        part === ''
            ? []
            : part.split(':').flatMap((group) => {
                  if (!group.includes('.')) return [parseInt(group, 16)];
                  const [a, b, c, d] = group.split('.').map(Number);
                  return [(a << 8) | b, (c << 8) | d];
              });
    const [head, tail] = address.split('::');
    const left = parse(head);
    const right = tail === undefined ? [] : parse(tail);
    return [...left, ...new Array<number>(8 - left.length - right.length).fill(0), ...right];
}

/**
 * The key a client IP is rate-limited under: an IPv4 address as is (also when
 * written as `::ffff:192.0.2.1`, as dual-stack sockets report IPv4 clients),
 * an IPv6 address by its /64 prefix, in one canonical form whatever the
 * notation (compressed, zone id, brackets, port). One IPv6 host usually gets a
 * whole /64, so keying on the full address let it take a fresh budget for
 * every address it rotated to. Anything that is not an IP is returned as is.
 */
export function clientIpKey(ip: string): string {
    const address = ip
        .trim()
        .replace(/^\[([^\]]*)\](?::\d+)?$/, '$1') // [v6] or [v6]:port
        .replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/, '$1') // v4:port
        .replace(/%.*$/, ''); // zone id (fe80::1%eth0)
    if (isIPv4(address)) return address;
    if (!isIPv6(address)) return ip;

    const groups = ipv6Groups(address);
    if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
        return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.');
    }
    return `${groups
        .slice(0, 4)
        .map((g) => g.toString(16))
        .join(':')}::/64`;
}
