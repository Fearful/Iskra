import type { AuthConfig, Feature, Kernel } from "../../types";
import type { Context, Hono, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { type Auth, createBetterAuth } from "./better-auth-config";
import { z } from "@hono/zod-openapi";
import type { DbFeature } from "../db";
import type { OpenAPIFeature } from "../openapi";
import type { User } from "./types";

declare module "hono" {
    interface ContextVariableMap {
        user: User | null;
        authUser: User | null;
    }
}

// ─── OpenAPI Schemas ─────────────────────────────────────────────────────────

const SignInSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
});

const SignUpSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().optional(),
});

const AuthSuccessSchema = z.object({
    token: z.string().optional(),
    user: z.object({
        id: z.string(),
        email: z.string(),
        name: z.string().optional(),
    }).optional(),
    session: z.any().optional(),
});

const SessionResponseSchema = z.object({
    session: z.any().nullable(),
    user: z.any().nullable(),
});

// ─── Auth Feature ────────────────────────────────────────────────────────────

export class AuthFeature implements Feature {
    name = "auth";
    dependencies = ["db"];

    private auth: Auth | undefined;
    private config: Required<Pick<AuthConfig, "secret" | "basePath">> & AuthConfig;
    private kernel?: Kernel;
    private authMode: "oidc" | "email";

    constructor(config: AuthConfig) {
        this.config = {
            ...config,
            basePath: config.basePath || "/api/sso",
            baseURL: config.baseURL || "http://localhost:3000",
        };

        if (config.authMode === "oidc" || config.authMode === "email") {
            this.authMode = config.authMode;
        } else {
            this.authMode = config.oidcConfig ? "oidc" : "email";
        }
    }

    async initialize(kernel: Kernel): Promise<void> {
        this.kernel = kernel;
        const dbFeature = kernel.getFeature("db") as unknown as DbFeature;
        if (!dbFeature) {
            throw new Error("AuthFeature requires DbFeature");
        }

        const db = dbFeature.db;
        const adapterType = dbFeature.adapter as "postgres" | "mysql" | "sqlite";

        if (!adapterType) {
            throw new Error("DbFeature must expose 'adapter' type (postgres, mysql, sqlite)");
        }

        this.auth = createBetterAuth({
            db,
            adapterType,
            secret: this.config.secret,
            baseURL: this.config.baseURL,
            basePath: this.config.basePath,
            trustedOrigins: this.config.trustedOrigins,
            enableEmailPassword: true,
            disableCSRFCheck: this.config.disableCSRFCheck,
            socialProviders: this.config.socialProviders,
            oidcConfig: this.config.oidcConfig,
        });

        const app = kernel.getApp();
        app.use("*", async (c: Context, next: Next) => {
            try {
                const session = await this.auth!.api.getSession({
                    headers: c.req.raw.headers,
                });

                if (session && session.user) {
                    c.set("user", session.user);
                    c.set("authUser", session.user);
                }
            } catch (error) {
                // Ignore session errors (just not logged in)
            }
            await next();
        });

        console.log("✅ Auth feature initialized (better-auth)");
    }

    routes(app: Hono): void {
        if (!this.auth) {
            throw new Error("Auth not initialized");
        }

        const base = this.config.basePath!;
        const openapi = this.kernel?.getFeature("openapi") as OpenAPIFeature | undefined;

        // Register explicit OpenAPI-documented routes
        if (openapi) {
            openapi.addRoute(
                {
                    method: "post",
                    path: `${base}/sign-in/email`,
                    tags: ["Auth"],
                    summary: "Sign in with email and password",
                    request: {
                        body: {
                            content: { "application/json": { schema: SignInSchema } },
                        },
                    },
                    responses: {
                        200: {
                            description: "Sign in successful",
                            content: { "application/json": { schema: AuthSuccessSchema } },
                        },
                        401: { description: "Invalid credentials" },
                    },
                },
                (c: any) => this.auth!.handler(c.req.raw),
            );

            openapi.addRoute(
                {
                    method: "post",
                    path: `${base}/sign-up/email`,
                    tags: ["Auth"],
                    summary: "Create a new account",
                    request: {
                        body: {
                            content: { "application/json": { schema: SignUpSchema } },
                        },
                    },
                    responses: {
                        200: {
                            description: "Account created",
                            content: { "application/json": { schema: AuthSuccessSchema } },
                        },
                        400: { description: "Validation error" },
                    },
                },
                (c: any) => this.auth!.handler(c.req.raw),
            );

            openapi.addRoute(
                {
                    method: "post",
                    path: `${base}/sign-out`,
                    tags: ["Auth"],
                    summary: "Sign out",
                    responses: {
                        200: { description: "Signed out" },
                    },
                },
                (c: any) => this.auth!.handler(c.req.raw),
            );

            openapi.addRoute(
                {
                    method: "get",
                    path: `${base}/get-session`,
                    tags: ["Auth"],
                    summary: "Get current session",
                    responses: {
                        200: {
                            description: "Current session",
                            content: { "application/json": { schema: SessionResponseSchema } },
                        },
                    },
                },
                (c: any) => this.auth!.handler(c.req.raw),
            );
        }

        // Catch-all for all other auth routes (OAuth callbacks, etc.)
        app.on(["POST", "GET"], `${base}/*`, (c) => {
            return this.auth!.handler(c.req.raw);
        });
    }

    getAuth(): Auth | undefined {
        return this.auth;
    }
}

export function requireAuth(kernel: Kernel) {
    return async (c: Context, next: Next) => {
        const authFeature = kernel.getFeature("auth") as AuthFeature;
        if (!authFeature) throw new HTTPException(500, { message: "Auth not initialized" });

        const auth = authFeature.getAuth();
        if (!auth) throw new HTTPException(500, { message: "Auth not ready" });

        const session = await auth.api.getSession({ headers: c.req.raw.headers });
        if (!session || !session.user) {
            throw new HTTPException(401, { message: "Unauthorized" });
        }

        c.set("user", session.user);
        c.set("authUser", session.user);
        await next();
    };
}
