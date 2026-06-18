import { betterAuth, type Auth as BetterAuthInstance } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { pgSchema, mysqlSchema, sqliteSchema } from "./schema";

export interface BetterAuthConfigOptions {
    db: any; // Drizzle instance
    adapterType: "postgres" | "mysql" | "sqlite";
    secret: string;
    baseURL?: string;
    basePath?: string;
    trustedOrigins?: string[];
    enableEmailPassword?: boolean;
    disableCSRFCheck?: boolean;
    // deno-lint-ignore no-explicit-any
    socialProviders?: Record<string, any>;
    oidcConfig?: {
        clientId: string;
        clientSecret: string;
        issuer: string;
        providerId?: string;
        authorizationEndpoint?: string;
        tokenEndpoint?: string;
        userinfoEndpoint?: string;
        jwksEndpoint?: string;
        discoveryEndpoint?: string;
        scopes?: string[];
        pkce?: boolean;
        mapping?: {
            id?: string;
            email?: string;
            emailVerified?: string;
            name?: string;
            image?: string;
            extraFields?: Record<string, string>;
        };
    };
}

export function createBetterAuth(options: BetterAuthConfigOptions): BetterAuthInstance {
    const {
        db,
        adapterType,
        secret,
        baseURL = "http://localhost:3000",
        basePath = "/api/auth",
        trustedOrigins = [],
        enableEmailPassword = true,
        disableCSRFCheck = false,
        socialProviders,
        oidcConfig,
    } = options;

    const baseOrigin = new URL(baseURL).origin;
    const allTrustedOrigins = trustedOrigins.includes(baseOrigin)
        ? trustedOrigins
        : [baseOrigin, ...trustedOrigins];

    console.log("[BetterAuth Config] Creating Drizzle adapter...");

    let schema;
    let provider: "pg" | "mysql" | "sqlite";

    switch (adapterType) {
        case "postgres":
            schema = pgSchema;
            provider = "pg";
            break;
        case "mysql":
            schema = mysqlSchema;
            provider = "mysql";
            break;
        case "sqlite":
            schema = sqliteSchema;
            provider = "sqlite";
            break;
        default:
            throw new Error(`Unsupported adapter type: ${adapterType}`);
    }

    const database = drizzleAdapter(db, {
        provider,
        schema
    });

    console.log("[BetterAuth Config] Initializing betterAuth with config:", {
        baseURL,
        basePath,
        provider,
        enableEmailPassword
    });

    const plugins = [];
    if (oidcConfig) {
        const authorizationUrl = oidcConfig.authorizationEndpoint ||
            `${oidcConfig.issuer}/protocol/openid-connect/auth`;
        const tokenUrl = oidcConfig.tokenEndpoint ||
            `${oidcConfig.issuer}/protocol/openid-connect/token`;
        const userInfoUrl = oidcConfig.userinfoEndpoint ||
            `${oidcConfig.issuer}/protocol/openid-connect/userinfo`;

        plugins.push(
            genericOAuth({
                config: [
                    {
                        providerId: oidcConfig.providerId || "oidc",
                        clientId: oidcConfig.clientId,
                        clientSecret: oidcConfig.clientSecret,
                        authorizationUrl,
                        tokenUrl,
                        userInfoUrl,
                        discoveryUrl: oidcConfig.discoveryEndpoint ||
                            `${oidcConfig.issuer}/.well-known/openid-configuration`,
                        scopes: oidcConfig.scopes || ["openid", "email", "profile"],
                        pkce: oidcConfig.pkce !== undefined ? oidcConfig.pkce : false,
                        mapProfileToUser: (profile: any) => {
                            return {
                                id: profile.sub || profile.id,
                                email: profile.email,
                                name: profile.name || profile.preferred_username,
                                image: profile.picture || profile.image,
                                emailVerified: profile.email_verified || false,
                            };
                        },
                    },
                ],
            }),
        );
    }

    return betterAuth({
        database,
        secret,
        baseURL,
        basePath,
        trustedOrigins: allTrustedOrigins,
        emailAndPassword: enableEmailPassword
            ? {
                enabled: true,
                autoSignIn: true,
            }
            : undefined,
        socialProviders: Object.keys(socialProviders || {}).length > 0 ? socialProviders : undefined,
        plugins,
        session: {
            expiresIn: 60 * 60 * 24 * 7,
            updateAge: 60 * 60 * 24,
            cookieCache: {
                enabled: true,
                maxAge: 5 * 60,
            },
        },
        advanced: {
            disableCSRFCheck,
            generateId: () => crypto.randomUUID().replace(/-/g, ""),
        },
    }) as unknown as BetterAuthInstance;
}

export type Auth = ReturnType<typeof createBetterAuth>;
