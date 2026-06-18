import type { Feature, CsrfConfig } from "../types";
import type { Kernel } from "../kernel";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { getCookie, setCookie } from "hono/cookie";

declare module "hono" {
    interface ContextVariableMap {
        csrfToken: string;
    }
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
            token = crypto.randomUUID().replace(/-/g, '');
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
        const headerToken = c.req.header(this.config.headerName);
        if (headerToken === expectedToken) return true;

        try {
            const contentType = c.req.header("content-type");
            if (contentType?.includes("application/x-www-form-urlencoded")) {
                const body = await c.req.parseBody();
                const bodyToken = body._csrf || body[this.config.cookieName];
                if (String(bodyToken) === expectedToken) return true;
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
