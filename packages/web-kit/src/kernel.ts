import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Context, Next } from 'hono';
import type { Feature, KernelConfig, SecurityHeadersConfig } from './types';
import { consoleLogger, silentLogger, type KernelLogger } from './logging';
import type { FeatureRegistry } from './feature-registry';

/**
 * Core microkernel orchestrator that manages features, dependencies, and application lifecycle.
 */
export class Kernel {
    private app: Hono;
    private config: KernelConfig;
    private features: Map<string, Feature> = new Map();
    private initialized = false;
    private logger: KernelLogger;

    constructor(config: KernelConfig = {}) {
        this.config = {
            port: 8000,
            // All interfaces, like Bun.serve itself: "localhost" made the server
            // unreachable from outside a container. Set "127.0.0.1" to restrict.
            hostname: '0.0.0.0',
            maxRequestBodySize: 16 * 1024 * 1024,
            ...config,
        };
        this.logger = config.logger === false ? silentLogger : (config.logger ?? consoleLogger);
        this.app = new Hono();

        // Add default error handler for HTTPException
        this.app.onError((err: Error, c: Context): Response | Promise<Response> => {
            // A custom response (e.g. basicAuth's 401 with WWW-Authenticate)
            // is sent as is.
            if (err instanceof HTTPException && err.res) return err.getResponse();
            if (err instanceof HTTPException) {
                return c.json({ message: err.message }, err.status);
            }

            this.logger.error('Unhandled error', err);
            return c.json({ message: 'Internal Server Error' }, 500);
        });
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            throw new Error('Kernel already initialized');
        }

        this.logger.debug('Initializing Web-Kit Kernel');

        this.validateFeatureDependencies();
        await this.validatePeerDependencies();
        this.applySecurityHeaders();

        // Every feature's middleware first, then every feature's routes: Hono
        // runs only the middleware registered before a route, so registering
        // each feature's routes right after its own initialize() left them
        // without the CSRF, rate-limit, auth or CORS middleware of the
        // features registered after it.
        const orderedFeatures = this.sortFeaturesByDependencies();
        for (const feature of orderedFeatures) {
            this.logger.debug(`Initializing feature: ${feature.name}`);
            await feature.initialize(this);
        }
        for (const feature of orderedFeatures) {
            feature.routes?.(this.app);
        }

        this.initialized = true;
        this.logger.info(
            `Web-Kit Kernel initialized (${orderedFeatures.map((f) => f.name).join(', ') || 'no features'})`,
        );
    }

    private applySecurityHeaders(): void {
        // User settings are merged over the defaults: passing one option used to
        // replace the whole object and silently drop the other headers.
        // X-XSS-Protection is off by default: the legacy auditor it enables is
        // gone from modern browsers and could itself be abused (OWASP).
        const headers: SecurityHeadersConfig = {
            xFrameOptions: 'SAMEORIGIN',
            xContentTypeOptions: true,
            xXssProtection: false,
            referrerPolicy: 'strict-origin-when-cross-origin',
            ...this.config.securityHeaders,
        };
        this.config.securityHeaders = headers;

        this.app.use('*', async (c: Context, next: Next) => {
            await next();

            if (headers.xFrameOptions) {
                c.res.headers.set('X-Frame-Options', headers.xFrameOptions);
            }
            if (headers.xContentTypeOptions) {
                c.res.headers.set('X-Content-Type-Options', 'nosniff');
            }
            if (headers.xXssProtection) {
                c.res.headers.set('X-XSS-Protection', '1; mode=block');
            }
            if (headers.referrerPolicy) {
                c.res.headers.set('Referrer-Policy', headers.referrerPolicy);
            }
            if (headers.strictTransportSecurity) {
                const hsts = headers.strictTransportSecurity;
                let hstsValue = `max-age=${hsts.maxAge || 31536000}`;
                if (hsts.includeSubDomains) hstsValue += '; includeSubDomains';
                if (hsts.preload) hstsValue += '; preload';
                c.res.headers.set('Strict-Transport-Security', hstsValue);
            }
            if (headers.contentSecurityPolicy) {
                if (typeof headers.contentSecurityPolicy === 'string') {
                    c.res.headers.set('Content-Security-Policy', headers.contentSecurityPolicy);
                } else if (headers.contentSecurityPolicy.directives) {
                    const directives = Object.entries(headers.contentSecurityPolicy.directives)
                        .map(([key, value]) => {
                            const values = Array.isArray(value) ? value.join(' ') : value;
                            return `${key} ${values}`;
                        })
                        .join('; ');
                    c.res.headers.set('Content-Security-Policy', directives);
                }
            }
            if (headers.permissionsPolicy) {
                const policy = Object.entries(headers.permissionsPolicy)
                    .map(([key, value]) => `${key}=(${value.join(' ')})`)
                    .join(', ');
                c.res.headers.set('Permissions-Policy', policy);
            }
        });
    }

    registerFeature(feature: Feature): void {
        if (this.initialized) {
            throw new Error('Cannot register features after initialization');
        }

        this.features.set(feature.name, feature);
    }

    private validateFeatureDependencies(): void {
        for (const [name, feature] of this.features) {
            if (feature.dependencies) {
                for (const dep of feature.dependencies) {
                    if (!this.features.has(dep)) {
                        throw new Error(`Feature '${name}' requires feature '${dep}' which is not registered`);
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
                    this.logger.warn(`Feature '${featureName}' requires peer dependency: ${dep}`);
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

    getApp(): Hono {
        return this.app;
    }

    getConfig(): Readonly<KernelConfig> {
        return this.config;
    }

    /** The logger features should use (see `KernelConfig.logger`). */
    getLogger(): KernelLogger {
        return this.logger;
    }

    /** Replaces the logger; only before initialize() (WebPlugin passes the App's). */
    setLogger(logger: KernelLogger): void {
        if (this.initialized) throw new Error('Cannot change the logger after initialization');
        this.logger = logger;
    }

    /**
     * A registered feature. Built-in names (and names added to FeatureRegistry)
     * return their feature's type; any other name takes the type as `T`.
     */
    getFeature<K extends keyof FeatureRegistry>(name: K): FeatureRegistry[K] | undefined;
    getFeature<T extends Feature = Feature>(name: string): T | undefined;
    getFeature(name: string): Feature | undefined {
        return this.features.get(name);
    }

    private server: any;

    async start(): Promise<void> {
        if (!this.initialized) {
            await this.initialize();
        }

        // Iskra uses Bun, so we can use Bun.serve
        // Hono handles this automatically if using the right adapter or just passing app.fetch to Bun.serve
        // But let's assume standard Bun usage from the user
        this.logger.info(`Server running at http://${this.config.hostname}:${this.config.port}`);

        if (typeof Bun !== 'undefined') {
            this.server = Bun.serve({
                port: this.config.port,
                hostname: this.config.hostname,
                maxRequestBodySize: this.config.maxRequestBodySize,
                ...(this.config.idleTimeout !== undefined ? { idleTimeout: this.config.idleTimeout } : {}),
                fetch: this.app.fetch,
            });
        } else {
            this.logger.warn('Not running in Bun, start() might strictly need an adapter.');
        }
    }

    /**
     * Stops accepting connections, waits for in-flight requests to finish, then
     * shuts features down in reverse dependency order (the auth feature before
     * the db it uses). Every feature is shut down even if one fails; the
     * failures are rethrown together at the end.
     */
    async shutdown(): Promise<void> {
        this.logger.info('Shutting down');

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
                this.logger.warn(`Open connections did not drain within ${graceMs}ms; closing them`);
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
                this.logger.error(`Feature "${feature.name}" failed to shut down`, err);
                errors.push(err);
            }
        }
        if (errors.length > 0) {
            throw new AggregateError(errors, `${errors.length} feature(s) failed to shut down`);
        }
        this.logger.info('Server shut down gracefully');
    }
}
