import type { Context } from "hono";
import { getConnInfo } from "hono/bun";

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

function trustedHops(trustProxy: TrustProxy | undefined): number {
    if (trustProxy === true) return 1;
    if (typeof trustProxy === "number" && trustProxy > 0) return Math.floor(trustProxy);
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

/**
 * Resolves the client's IP address, or `undefined` when it cannot be
 * determined (no socket and no trusted forwarding header).
 */
export function getClientIp(c: Context, trustProxy?: TrustProxy): string | undefined {
    const socket = socketAddress(c);
    const hops = trustedHops(trustProxy);
    if (hops === 0) return socket;

    const forwarded = (c.req.header("x-forwarded-for") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    if (forwarded.length === 0) {
        return c.req.header("x-real-ip")?.trim() || socket;
    }

    // The last hop is the socket peer (the nearest proxy). Without a socket we
    // still count it as one hop so the result matches production.
    const chain = [...forwarded, socket ?? ""];
    return chain[Math.max(0, chain.length - 1 - hops)] || undefined;
}
