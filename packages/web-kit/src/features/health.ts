import type { Feature, HealthBody, HealthCheckConfig, HealthReport } from '../types';
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
    private config: {
        path: string | false;
        readinessPath: string | false;
        livenessPath: string | false;
        includeDetails: boolean;
        checkTimeoutMs: number;
        checks?: HealthCheckConfig['checks'];
        body: NonNullable<HealthCheckConfig['body']>;
    };
    private readinessChecks: Map<string, () => Promise<boolean>>;

    constructor(config: HealthCheckConfig = {}) {
        this.config = {
            path: config.path === false ? false : config.path || '/health',
            readinessPath: config.readinessPath === false ? false : config.readinessPath || '/health/ready',
            livenessPath: config.livenessPath === false ? false : config.livenessPath || '/health/live',
            includeDetails: config.includeDetails !== undefined ? config.includeDetails : false,
            checkTimeoutMs: config.checkTimeoutMs ?? 2000,
            checks: config.checks,
            body: config.body ?? {},
        };
        const initial = config.readinessChecks ?? {};
        this.readinessChecks = new Map(Object.entries(initial));
    }

    /** The routes this feature serves, which the rate limiter leaves out by default. */
    get paths(): string[] {
        return [this.config.path, this.config.readinessPath, this.config.livenessPath].filter(
            (path): path is string => path !== false,
        );
    }

    addReadinessCheck(name: string, check: () => Promise<boolean>): void {
        this.readinessChecks = new Map([...this.readinessChecks, [name, check]]);
    }

    /**
     * Adds a check to /health, like one in `checks`; features add theirs in
     * initialize() (they list 'health' in `optionalDependencies` to run after
     * it). A name already taken is an error: one check would hide the other.
     */
    addCheck(name: string, check: NonNullable<HealthCheckConfig['checks']>[string]): void {
        if (this.config.checks && Object.hasOwn(this.config.checks, name)) {
            throw new Error(`HealthCheckFeature: a check named "${name}" is already registered`);
        }
        this.config.checks = { ...this.config.checks, [name]: check };
    }

    async initialize(kernel: Kernel): Promise<void> {
        this.log = kernel.getLogger();
        this.kernel = kernel;
        this.log.debug('Health check feature initialized');
    }

    routes(app: Hono): void {
        const { path, readinessPath, livenessPath } = this.config;
        if (path !== false) app.get(path, async (c: Context) => await this.handleHealthCheck(c));
        if (readinessPath !== false) app.get(readinessPath, async (c: Context) => await this.handleReadinessCheck(c));
        if (livenessPath !== false) app.get(livenessPath, async (c: Context) => await this.handleLivenessCheck(c));
    }

    /** The app's body for this endpoint, if it set one; otherwise `fallback`. */
    private respond(c: Context, report: HealthReport, custom: HealthBody | undefined, fallback: unknown): Response {
        const status = report.ok ? 200 : 503;
        if (!custom) return c.json(fallback, status);
        const body = custom(report, c);
        return body instanceof Response ? body : c.json(body, status);
    }

    private report(endpoint: HealthReport['endpoint'], checks: HealthReport['checks']): HealthReport {
        const failed = Object.entries(checks)
            .filter(([, result]) => result?.status === 'error')
            .map(([name]) => name);
        return {
            endpoint,
            ok: failed.length === 0,
            checks,
            failed,
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
        };
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

        const report = this.report('health', { ...checks, ...customChecks });
        report.ok = healthy;

        const response: Record<string, unknown> = {
            status: healthy ? 'ok' : 'error',
            timestamp: report.timestamp,
        };

        if (this.config.includeDetails && this.kernel) {
            response.features = this.kernel.getFeatureNames();
            if (Object.keys(checks).length > 0) response.checks = checks;
            if (Object.keys(customChecks).length > 0) response.customChecks = customChecks;
        }

        return this.respond(c, report, this.config.body.health, response);
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

        const report = this.report(
            'ready',
            Object.fromEntries(
                Object.entries(results).map(([name, passed]) => [name, { status: passed ? 'ok' : 'error' }]),
            ),
        );

        // The status code is what an orchestrator acts on. Check names can
        // name internal hosts (`postgres-primary-10.0.3.12`), so like /health
        // the body lists them only with includeDetails; the log has them.
        const details = this.config.includeDetails && this.readinessChecks.size > 0;
        if (failed.length > 0) {
            this.log.warn(`Readiness checks failed: ${failed.join(', ')}`);
        }
        const body = {
            status: failed.length > 0 ? 'not ready' : 'ready',
            ...(details && { checks: results }),
            ...(details && failed.length > 0 && { failed }),
        };
        return this.respond(c, report, this.config.body.ready, body);
    }

    private async handleLivenessCheck(c: Context) {
        const report = this.report('live', {});
        const body = {
            status: 'alive',
            timestamp: report.timestamp,
            ...(this.config.includeDetails && { uptime: report.uptime }),
        };
        return this.respond(c, report, this.config.body.live, body);
    }
}
