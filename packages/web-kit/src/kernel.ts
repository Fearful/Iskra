import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Context, Next } from "hono";
import type { Feature, KernelConfig, SecurityHeadersConfig } from "./types";

/**
 * Core microkernel orchestrator that manages features, dependencies, and application lifecycle.
 */
export class Kernel {
    private app: Hono;
    private config: KernelConfig;
    private features: Map<string, Feature> = new Map();
    private initialized = false;

    constructor(config: KernelConfig = {}) {
        this.config = {
            port: 8000,
            // All interfaces, like Bun.serve itself: "localhost" made the server
            // unreachable from outside a container. Set "127.0.0.1" to restrict.
            hostname: "0.0.0.0",
            maxRequestBodySize: 16 * 1024 * 1024,
            ...config,
        };
        this.app = new Hono();

        // Add default error handler for HTTPException
        this.app.onError((err: Error, c: Context): Response | Promise<Response> => {
            if (err instanceof HTTPException) {
                return c.json(
                    { message: err.message },
                    err.status,
                );
            }

            console.error("Unhandled error:", err);
            return c.json(
                { message: "Internal Server Error" },
                500,
            );
        });
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            throw new Error("Kernel already initialized");
        }

        console.log("🚀 Initializing Web-Kit Kernel...");

        this.validateFeatureDependencies();
        await this.validatePeerDependencies();
        this.applySecurityHeaders();

        const orderedFeatures = this.sortFeaturesByDependencies();
        for (const feature of orderedFeatures) {
            await this.initializeFeature(feature);
        }

        this.initialized = true;
        console.log("✅ Web-Kit Kernel initialized");
    }

    private applySecurityHeaders(): void {
        // User settings are merged over the defaults: passing one option used to
        // replace the whole object and silently drop the other headers.
        // X-XSS-Protection is off by default: the legacy auditor it enables is
        // gone from modern browsers and could itself be abused (OWASP).
        const headers: SecurityHeadersConfig = {
            xFrameOptions: "SAMEORIGIN",
            xContentTypeOptions: true,
            xXssProtection: false,
            referrerPolicy: "strict-origin-when-cross-origin",
            ...this.config.securityHeaders,
        };
        this.config.securityHeaders = headers;

        this.app.use("*", async (c: Context, next: Next) => {
            await next();

            if (headers.xFrameOptions) {
                c.res.headers.set("X-Frame-Options", headers.xFrameOptions);
            }
            if (headers.xContentTypeOptions) {
                c.res.headers.set("X-Content-Type-Options", "nosniff");
            }
            if (headers.xXssProtection) {
                c.res.headers.set("X-XSS-Protection", "1; mode=block");
            }
            if (headers.referrerPolicy) {
                c.res.headers.set("Referrer-Policy", headers.referrerPolicy);
            }
            if (headers.strictTransportSecurity) {
                const hsts = headers.strictTransportSecurity;
                let hstsValue = `max-age=${hsts.maxAge || 31536000}`;
                if (hsts.includeSubDomains) hstsValue += "; includeSubDomains";
                if (hsts.preload) hstsValue += "; preload";
                c.res.headers.set("Strict-Transport-Security", hstsValue);
            }
            if (headers.contentSecurityPolicy) {
                if (typeof headers.contentSecurityPolicy === "string") {
                    c.res.headers.set(
                        "Content-Security-Policy",
                        headers.contentSecurityPolicy,
                    );
                } else if (headers.contentSecurityPolicy.directives) {
                    const directives = Object.entries(
                        headers.contentSecurityPolicy.directives,
                    )
                        .map(([key, value]) => {
                            const values = Array.isArray(value) ? value.join(" ") : value;
                            return `${key} ${values}`;
                        })
                        .join("; ");
                    c.res.headers.set("Content-Security-Policy", directives);
                }
            }
            if (headers.permissionsPolicy) {
                const policy = Object.entries(headers.permissionsPolicy)
                    .map(([key, value]) => `${key}=(${value.join(" ")})`)
                    .join(", ");
                c.res.headers.set("Permissions-Policy", policy);
            }
        });
    }

    registerFeature(feature: Feature): void {
        if (this.initialized) {
            throw new Error("Cannot register features after initialization");
        }

        this.features.set(feature.name, feature);
        console.log(`📦 Registered feature: ${feature.name}`);
    }

    private validateFeatureDependencies(): void {
        for (const [name, feature] of this.features) {
            if (feature.dependencies) {
                for (const dep of feature.dependencies) {
                    if (!this.features.has(dep)) {
                        throw new Error(
                            `Feature '${name}' requires feature '${dep}' which is not registered`,
                        );
                    }
                }
            }
        }
    }

    private async validatePeerDependencies(): Promise<void> {
        for (const [featureName, feature] of this.features) {
            for (const dep of feature.peerDependencies ?? []) {
                // Awaited: registerFeature() used to fire an un-awaited import()
                // inside a sync try/catch, so a missing package became an
                // unhandled rejection that crashed the process.
                try {
                    await import(dep);
                } catch {
                    console.warn(
                        `⚠️  Warning: Feature '${featureName}' requires peer dependency: ${dep}`,
                    );
                }
            }
        }
    }

    private sortFeaturesByDependencies(): Feature[] {
        const sorted: Feature[] = [];
        const visited = new Set<string>();
        const visiting = new Set<string>();

        const visit = (name: string) => {
            if (visited.has(name)) return;
            if (visiting.has(name)) {
                throw new Error(`Circular dependency detected for feature: ${name}`);
            }

            visiting.add(name);
            const feature = this.features.get(name)!;

            if (feature.dependencies) {
                for (const dep of feature.dependencies) {
                    visit(dep);
                }
            }

            visiting.delete(name);
            visited.add(name);
            sorted.push(feature);
        };

        for (const name of this.features.keys()) {
            visit(name);
        }

        return sorted;
    }

    private async initializeFeature(feature: Feature): Promise<void> {
        console.log(`⚙️  Initializing feature: ${feature.name}`);
        await feature.initialize(this);

        if (feature.routes) {
            feature.routes(this.app);
        }
    }

    getApp(): Hono {
        return this.app;
    }

    getConfig(): Readonly<KernelConfig> {
        return this.config;
    }

    getFeature<T extends Feature>(name: string): T | undefined {
        return this.features.get(name) as T;
    }

    private server: any;

    async start(): Promise<void> {
        if (!this.initialized) {
            await this.initialize();
        }

        // Iskra uses Bun, so we can use Bun.serve
        // Hono handles this automatically if using the right adapter or just passing app.fetch to Bun.serve
        // But let's assume standard Bun usage from the user
        console.log(
            `🌐 Server running at http://${this.config.hostname}:${this.config.port}`,
        );

        if (typeof Bun !== "undefined") {
            this.server = Bun.serve({
                port: this.config.port,
                hostname: this.config.hostname,
                maxRequestBodySize: this.config.maxRequestBodySize,
                ...(this.config.idleTimeout !== undefined ? { idleTimeout: this.config.idleTimeout } : {}),
                fetch: this.app.fetch,
            });
        } else {
            console.warn("Not running in Bun, start() might strictly need an adapter.");
        }
    }

    /**
     * Stops accepting connections, waits for in-flight requests to finish, then
     * shuts features down in reverse dependency order (the auth feature before
     * the db it uses). Every feature is shut down even if one fails; the
     * failures are rethrown together at the end.
     */
    async shutdown(): Promise<void> {
        console.log("🛑 Shutting down...");

        if (this.server) {
            const server = this.server;
            this.server = null;
            // Graceful stop waits for in-flight requests, but it can hang on a
            // connection that never settles (Bun 1.1 does so after answering a
            // 413), so force-close whatever is left after the grace period.
            const graceMs = this.config.shutdownGraceMs ?? 5000;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const drained = await Promise.race([
                Promise.resolve(server.stop()).then(() => true),
                new Promise<boolean>((resolve) => {
                    timer = setTimeout(() => resolve(false), graceMs);
                }),
            ]);
            clearTimeout(timer);
            if (!drained) {
                console.warn(`⚠️ Open connections did not drain within ${graceMs}ms; closing them`);
                // Not awaited: the listener closes immediately, but in that same
                // Bun 1.1 case the returned promise never settles either.
                Promise.resolve(server.stop(true)).catch(() => {});
            }
        }

        const errors: unknown[] = [];
        for (const feature of this.sortFeaturesByDependencies().reverse()) {
            if (!feature.shutdown) continue;
            try {
                await feature.shutdown();
            } catch (err) {
                console.error(`Feature "${feature.name}" failed to shut down:`, err);
                errors.push(err);
            }
        }
        if (errors.length > 0) {
            throw new AggregateError(errors, `${errors.length} feature(s) failed to shut down`);
        }
        console.log("👋 Server shut down gracefully");
    }
}
