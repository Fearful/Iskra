import type { Feature, CsrfConfig } from '../types';
import type { Kernel } from '../kernel';
import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { getCookie, setCookie } from 'hono/cookie';
import { createHmac, timingSafeEqual, randomUUID } from 'crypto';
import { consoleLogger, type KernelLogger } from '../logging';

declare module 'hono' {
    interface ContextVariableMap {
        csrfToken: string;
        /** Checks the request's origin and its header/body token against the cookie token (used by requireCsrf). */
        verifyCsrf: () => Promise<boolean>;
    }
}

// ─── Signed Double-Submit Token ──────────────────────────────────────────────
//
// A CSRF token is `<random>.<hmac>` where the HMAC signs the random nonce under
// the configured secret (OWASP signed double-submit cookie), and the session
// ID when SessionFeature has stored a session for the request. Anonymous
// requests get unbound tokens: they mint a throwaway session ID per request,
// so binding would reject the first POST of every logged-out flow. Bound
// tokens stop a token planted in the cookie (e.g. by a sibling subdomain,
// which can set cookies for the parent domain) from passing for a logged-in
// victim: the attacker cannot sign one for the victim's session.

/** Minimum length, in characters, for the token-signing secret (same bar as SessionFeature). */
const MIN_SECRET_LENGTH = 32;

function constantTimeEqual(a: string, b: string): boolean {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    // timingSafeEqual throws on length mismatch; comparing lengths first keeps
    // the call safe. The length check is not constant-time, but token length is
    // not secret — the signature comparison below is what gates forgery.
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
}

function signCsrfToken(random: string, secret: string, sessionId?: string): string {
    const signature = createHmac('sha256', secret)
        .update(sessionId ? `${sessionId}.${random}` : random)
        .digest('base64url');
    return `${random}.${signature}`;
}

function verifyCsrfToken(token: string, secret: string, sessionId?: string): boolean {
    const lastDot = token.lastIndexOf('.');
    if (lastDot === -1) return false;

    const random = token.substring(0, lastDot);
    const expected = signCsrfToken(random, secret, sessionId);
    return constantTimeEqual(token, expected);
}

function newCsrfToken(secret: string, sessionId?: string): string {
    return signCsrfToken(randomUUID().replace(/-/g, ''), secret, sessionId);
}

export class CsrfFeature implements Feature {
    name = 'csrf';
    /** Its middleware reads the session, so SessionFeature's must run first. */
    optionalDependencies = ['session'];
    private log: KernelLogger = consoleLogger;
    private config: Required<Omit<CsrfConfig, 'trustedOrigins'>>;
    private trustedOrigins: Set<string>;

    constructor(config: CsrfConfig) {
        // Examples used to pass "csrf-secret": short enough to brute-force
        // offline from one token, and then any token can be forged.
        if (!config.secret || config.secret.length < MIN_SECRET_LENGTH) {
            throw new Error(
                `CSRF secret must be at least ${MIN_SECRET_LENGTH} characters; received ${config.secret ? config.secret.length : 0}`,
            );
        }
        const cookieOptions = {
            httpOnly: true,
            secure: true,
            sameSite: 'Strict' as const,
            maxAge: 86400,
            ...config.cookieOptions,
        };
        this.config = {
            secret: config.secret,
            // Only this host can set a __Host- cookie (Secure, Path=/, no
            // Domain): a sibling subdomain can no longer plant its own token.
            cookieName: config.cookieName || (cookieOptions.secure ? '__Host-csrf' : '_csrf'),
            headerName: config.headerName || 'X-CSRF-Token',
            ignoreMethods: config.ignoreMethods || ['GET', 'HEAD', 'OPTIONS'],
            cookieOptions,
        };
        this.trustedOrigins = new Set(
            (config.trustedOrigins ?? []).map((origin) => {
                try {
                    return new URL(origin).origin;
                } catch {
                    throw new Error(`CSRF trustedOrigins: invalid origin "${origin}"`);
                }
            }),
        );
    }

    async initialize(kernel: Kernel): Promise<void> {
        this.log = kernel.getLogger();
        const app = kernel.getApp();
        app.use('*', async (c: Context, next: Next) => {
            await this.middleware(c, next);
        });
        this.log.debug('CSRF feature initialized');
    }

    private setTokenCookie(c: Context, token: string): void {
        setCookie(c, this.config.cookieName, token, {
            httpOnly: this.config.cookieOptions.httpOnly,
            secure: this.config.cookieOptions.secure,
            sameSite: this.config.cookieOptions.sameSite,
            maxAge: this.config.cookieOptions.maxAge,
            path: '/',
        });
    }

    private async middleware(c: Context, next: Next) {
        const method = c.req.method.toUpperCase();
        // The stored session the token must be bound to, if any.
        const sessionId = c.get('sessionPersisted') ? c.get('sessionId') : undefined;
        const cookieToken = getCookie(c, this.config.cookieName);
        let token = cookieToken;

        // A token for another session (or none), e.g. the anonymous one from
        // before login, is replaced; an unsafe request carrying it fails below.
        if (!token || !verifyCsrfToken(token, this.config.secret, sessionId)) {
            token = newCsrfToken(this.config.secret, sessionId);
            this.setTokenCookie(c, token);
        }
        // Except an unbound one sent from the app's own pages: the page that
        // stored the session (a login without regenerateSession(), a cart)
        // was rendered with one, and its form would fail. Binding stops tokens
        // planted by another site, and those cannot be sent from there.
        const unbound =
            sessionId && cookieToken && cookieToken !== token && verifyCsrfToken(cookieToken, this.config.secret)
                ? cookieToken
                : undefined;

        c.set('csrfToken', token);
        const expectedToken = token;
        c.set('verifyCsrf', () => this.validateToken(c, expectedToken, unbound));

        // A new session ID (login) gets a new token bound to it.
        const regenerate = c.get('regenerateSession');
        if (regenerate) {
            c.set('regenerateSession', async () => {
                await regenerate();
                const rotated = newCsrfToken(this.config.secret, c.get('sessionId'));
                this.setTokenCookie(c, rotated);
                c.set('csrfToken', rotated);
            });
        }

        if (this.config.ignoreMethods.includes(method)) {
            await next();
            return;
        }

        const isValid = await this.validateToken(c, token, unbound);
        if (!isValid) {
            throw new HTTPException(403, { message: 'Invalid CSRF token' });
        }

        await next();
    }

    /** Whether the browser says the request comes from the app's own pages or a trusted origin. */
    private fromTrustedPage(c: Context): boolean {
        // The browser's own verdict holds even when a proxy in front (TLS,
        // another port) makes the URL the app sees differ from the page's.
        if (c.req.header('sec-fetch-site') === 'same-origin') return true;
        const origin = c.req.header('origin');
        return !!origin && (origin === new URL(c.req.url).origin || this.trustedOrigins.has(origin));
    }

    /**
     * Whether the request may come from where it does. The token alone could
     * not tell: a sibling subdomain can plant a cookie with a token it knows
     * and submit it, and SameSite does not stop it (same site). Requests
     * without `Origin` or `Sec-Fetch-Site` (other clients) are left to the token.
     */
    private originAllowed(c: Context): boolean {
        if (this.fromTrustedPage(c)) return true;
        if (c.req.header('origin')) return false;
        return c.req.header('sec-fetch-site') !== 'cross-site';
    }

    /**
     * Checks the origin, then the header or body token against the cookie's:
     * `expectedToken`, or `unbound` (see the middleware) when the browser says
     * the request comes from the app's own pages.
     */
    private async validateToken(c: Context, expectedToken: string, unbound?: string): Promise<boolean> {
        if (!this.originAllowed(c)) return false;

        const accepted = unbound && this.fromTrustedPage(c) ? [expectedToken, unbound] : [expectedToken];
        const matches = (candidate: string) => accepted.some((token) => constantTimeEqual(candidate, token));

        const headerToken = c.req.header(this.config.headerName);
        if (headerToken && matches(headerToken)) return true;

        try {
            const contentType = c.req.header('content-type');
            if (contentType?.includes('application/x-www-form-urlencoded')) {
                const body = await c.req.parseBody();
                const bodyToken = body._csrf || body[this.config.cookieName];
                if (bodyToken && matches(String(bodyToken))) return true;
            }
        } catch (error) {
            // A malformed/unparseable body just means no valid body token is
            // present; fall through to rejection. Surface detail at debug only.
            const logger = c.get('logger');
            if (logger?.debug) logger.debug('CSRF body token parse failed', { error });
        }

        return false;
    }
}

/**
 * Requires a valid CSRF token on this route, whatever its method — use it on
 * routes whose method is in `ignoreMethods` but still change state. Fails
 * closed when CsrfFeature is not registered.
 */
export function requireCsrf() {
    return async (c: Context, next: Next) => {
        // Previously this only checked that c.get("csrfToken") existed, which the
        // middleware always sets, so it guarded nothing.
        const verify = c.get('verifyCsrf');
        if (!verify || !(await verify())) throw new HTTPException(403, { message: 'Invalid CSRF token' });
        await next();
    };
}
