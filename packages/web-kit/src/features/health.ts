import type { Feature, HealthCheckConfig } from '../types';
import type { Kernel } from '../kernel';
import type { Context, Hono } from 'hono';
import { consoleLogger, type KernelLogger } from '../logging';

/** Rejects if `promise` does not settle within `ms` (a stuck probe must not hang /health). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`health check timed out after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class HealthCheckFeature implements Feature {
    name = 'health';
    private log: KernelLogger = consoleLogger;

    private kernel?: Kernel;
    private config: Required<Omit<HealthCheckConfig, 'checks' | 'readinessChecks'>> & {
        checks?: HealthCheckConfig['checks'];
    };
    private readinessChecks: Map<string, () => Promise<boolean>>;

    constructor(config: HealthCheckConfig = {}) {
        this.config = {
            path: config.path || '/health',
            readinessPath: config.readinessPath || '/health/ready',
            livenessPath: config.livenessPath || '/health/live',
            includeDetails: config.includeDetails !== undefined ? config.includeDetails : false,
            checkTimeoutMs: config.checkTimeoutMs ?? 2000,
            checks: config.checks,
        };
        const initial = config.readinessChecks ?? {};
        this.readinessChecks = new Map(Object.entries(initial));
    }

    addReadinessCheck(name: string, check: () => Promise<boolean>): void {
        this.readinessChecks = new Map([...this.readinessChecks, [name, check]]);
    }

    async initialize(kernel: Kernel): Promise<void> {
        this.log = kernel.getLogger();
        this.kernel = kernel;
        this.log.debug('Health check feature initialized');
    }

    routes(app: Hono): void {
        app.get(this.config.path, async (c: Context) => await this.handleHealthCheck(c));
        app.get(this.config.readinessPath, async (c: Context) => await this.handleReadinessCheck(c));
        app.get(this.config.livenessPath, async (c: Context) => await this.handleLivenessCheck(c));
    }

    /**
     * Runs the db/cache probes and custom checks on every request and answers
     * 503 with `status: "error"` when any fails, so a load balancer or
     * orchestrator can act on it. `includeDetails` only controls whether the
     * per-check results and feature list are included in the body.
     */
    private async handleHealthCheck(c: Context) {
        const checks: Record<string, { status: 'ok' | 'error' }> = {};

        const dbProbe = this.dbProbe(c);
        if (dbProbe) checks.db = await this.probe('db', dbProbe);

        const cache = this.kernel?.getFeature('cache')?.client;
        if (cache) {
            checks.cache = await this.probe('cache', () => cache.exists('__health_check__'));
        }

        const customChecks: Record<string, { status: 'ok' | 'error'; [key: string]: unknown }> = {};
        for (const [name, check] of Object.entries(this.config.checks ?? {})) {
            try {
                customChecks[name] = await withTimeout(check(c), this.config.checkTimeoutMs);
            } catch (error) {
                // Log the detail server-side; never serialize the raw error
                // (it may embed connection strings or other secrets) to the client.
                this.log.error(`Health custom check "${name}" failed`, error);
                customChecks[name] = { status: 'error' };
            }
        }

        const healthy =
            Object.values(checks).every((r) => r.status === 'ok') &&
            Object.values(customChecks).every((r) => r?.status !== 'error');

        const response: any = {
            status: healthy ? 'ok' : 'error',
            timestamp: new Date().toISOString(),
        };

        if (this.config.includeDetails && this.kernel) {
            // @ts-expect-error - features is a private kernel field accessed for diagnostics
            response.features = Array.from(this.kernel.features.keys());
            if (Object.keys(checks).length > 0) response.checks = checks;
            if (Object.keys(customChecks).length > 0) response.customChecks = customChecks;
        }

        return c.json(response, healthy ? 200 : 503);
    }

    /**
     * How to probe the registered "db" feature, if at all: DbFeature's ping()
     * (a real round-trip), or a context value with a query() function. A
     * Drizzle instance's `db.query` is the relational-query object, not a
     * function, so the old `db.query("SELECT 1")` probe never ran.
     */
    private dbProbe(c: Context): (() => Promise<unknown>) | null {
        const feature = this.kernel?.getFeature('db');
        if (!feature) return null;
        if (typeof feature.ping === 'function') return () => feature.ping();
        // A "db" feature of another shape may expose a query() function instead.
        const instance: unknown = c.get('db');
        const query = (instance as { query?: unknown } | undefined)?.query;
        if (typeof query === 'function') return () => query.call(instance, 'SELECT 1');
        return null;
    }

    private async probe(name: string, fn: () => Promise<unknown>): Promise<{ status: 'ok' | 'error' }> {
        try {
            await withTimeout(fn(), this.config.checkTimeoutMs);
            return { status: 'ok' };
        } catch (e) {
            // Log server-side; return only a generic status so DB/cache error
            // strings (which can carry connection details) never reach the client.
            this.log.error(`Health feature check "${name}" failed`, e);
            return { status: 'error' };
        }
    }

    private async handleReadinessCheck(c: Context) {
        if (this.readinessChecks.size === 0) {
            return c.json({ status: 'ready' });
        }

        const results: Record<string, boolean> = {};
        const failed: string[] = [];

        for (const [name, check] of this.readinessChecks) {
            try {
                // Bounded like the other checks: a hung one left the probe
                // pending until the orchestrator's own timeout.
                const passed = await withTimeout(Promise.resolve(check()), this.config.checkTimeoutMs);
                results[name] = passed;
                if (!passed) failed.push(name);
            } catch {
                results[name] = false;
                failed.push(name);
            }
        }

        if (failed.length > 0) {
            return c.json({ status: 'not ready', checks: results, failed }, 503);
        }

        return c.json({ status: 'ready', checks: results });
    }

    private async handleLivenessCheck(c: Context) {
        return c.json({
            status: 'alive',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
        });
    }
}
