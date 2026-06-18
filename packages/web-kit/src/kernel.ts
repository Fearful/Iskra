import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Context, Next } from "hono";
import type { Feature, KernelConfig } from "./types";

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
            hostname: "localhost",
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
        if (!this.config.securityHeaders) {
            this.config.securityHeaders = {
                xFrameOptions: "SAMEORIGIN",
                xContentTypeOptions: true,
                xXssProtection: true,
                referrerPolicy: "strict-origin-when-cross-origin",
            };
        }

        const headers = this.config.securityHeaders;

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

        if (feature.peerDependencies) {
            for (const dep of feature.peerDependencies) {
                try {
                    import(dep);
                } catch {
                    console.warn(
                        `⚠️  Warning: Feature '${feature.name}' requires peer dependency: ${dep}`,
                    );
                }
            }
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
            if (feature.peerDependencies) {
                for (const dep of feature.peerDependencies) {
                    // In Node/Bun dynamic import usually works for installed packages
                    // We can skip hard failure here or make it safer
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
                fetch: this.app.fetch,
            });
        } else {
            console.warn("Not running in Bun, start() might strictly need an adapter.");
        }
    }

    async shutdown(): Promise<void> {
        console.log("🛑 Shutting down...");

        if (this.server) {
            this.server.stop();
            this.server = null;
        }

        const features = Array.from(this.features.values()).reverse();
        for (const feature of features) {
            if (feature.shutdown) {
                await feature.shutdown();
            }
        }
        console.log("👋 Server shut down gracefully");
    }
}
