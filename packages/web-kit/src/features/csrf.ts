import type { Feature, CsrfConfig } from "../types";
import type { Kernel } from "../kernel";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { getCookie, setCookie } from "hono/cookie";
import { createHmac, timingSafeEqual, randomUUID } from "crypto";

declare module "hono" {
    interface ContextVariableMap {
        csrfToken: string;
    }
}

// ─── Signed Double-Submit Token ──────────────────────────────────────────────
//
// A CSRF token is `<random>.<hmac>` where the HMAC signs the random nonce under
// the configured secret (OWASP signed double-submit cookie). Forging a token
// requires the secret, and an attacker can neither read nor set the victim's
// cookie cross-origin. The nonce is intentionally NOT bound to the session id:
// anonymous flows mint a throwaway session id per request, so binding would
// reject the first POST of every logged-out flow.

function constantTimeEqual(a: string, b: string): boolean {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    // timingSafeEqual throws on length mismatch; comparing lengths first keeps
    // the call safe. The length check is not constant-time, but token length is
    // not secret — the signature comparison below is what gates forgery.
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
}

function signCsrfToken(random: string, secret: string): string {
    const signature = createHmac("sha256", secret)
        .update(random)
        .digest("base64url");
    return `${random}.${signature}`;
}

function verifyCsrfToken(token: string, secret: string): boolean {
    const lastDot = token.lastIndexOf(".");
    if (lastDot === -1) return false;

    const random = token.substring(0, lastDot);
    const expected = signCsrfToken(random, secret);
    return constantTimeEqual(token, expected);
}

export class CsrfFeature implements Feature {
    name = "csrf";
    private config: Required<CsrfConfig>;

    constructor(config: CsrfConfig) {
        if (!config.secret) throw new Error("CSRF secret is required");
        this.config = {
            secret: config.secret,
            cookieName: config.cookieName || "_csrf",
            headerName: config.headerName || "X-CSRF-Token",
            ignoreMethods: config.ignoreMethods || ["GET", "HEAD", "OPTIONS"],
            cookieOptions: {
                httpOnly: true,
                secure: true,
                sameSite: "Strict",
                maxAge: 86400,
                ...config.cookieOptions
            }
        } as Required<CsrfConfig>;
    }

    async initialize(kernel: Kernel): Promise<void> {
        const app = kernel.getApp();
        app.use("*", async (c: Context, next: Next) => {
            await this.middleware(c, next);
        });
        console.log("✅ CSRF feature initialized");
    }

    private async middleware(c: Context, next: Next) {
        const method = c.req.method.toUpperCase();
        let token = getCookie(c, this.config.cookieName);

        if (!token) {
            token = signCsrfToken(randomUUID().replace(/-/g, ""), this.config.secret);
            setCookie(c, this.config.cookieName, token, {
                httpOnly: this.config.cookieOptions.httpOnly,
                secure: this.config.cookieOptions.secure,
                sameSite: this.config.cookieOptions.sameSite as any,
                maxAge: this.config.cookieOptions.maxAge,
                path: "/"
            });
        }

        c.set("csrfToken", token);

        if (this.config.ignoreMethods.includes(method)) {
            await next();
            return;
        }

        const isValid = await this.validateToken(c, token);
        if (!isValid) {
            throw new HTTPException(403, { message: "Invalid CSRF token" });
        }

        await next();
    }

    private async validateToken(c: Context, expectedToken: string): Promise<boolean> {
        // The cookie token itself must carry a valid signature under the secret.
        // An unsigned or foreign token is rejected before any comparison, so a
        // token minted elsewhere cannot pass double-submit.
        if (!verifyCsrfToken(expectedToken, this.config.secret)) return false;

        const headerToken = c.req.header(this.config.headerName);
        if (headerToken && constantTimeEqual(headerToken, expectedToken)) return true;

        try {
            const contentType = c.req.header("content-type");
            if (contentType?.includes("application/x-www-form-urlencoded")) {
                const body = await c.req.parseBody();
                const bodyToken = body._csrf || body[this.config.cookieName];
                if (bodyToken && constantTimeEqual(String(bodyToken), expectedToken)) return true;
            }
        } catch { /* ignored */ }

        return false;
    }
}

export function requireCsrf() {
    return async (c: Context, next: Next) => {
        if (!c.get("csrfToken")) throw new HTTPException(403, { message: "CSRF token required" });
        await next();
    };
}
