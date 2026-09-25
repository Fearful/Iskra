import { describe, it, expect } from 'bun:test';
import { Kernel } from '../src/kernel';
import { HealthCheckFeature } from '../src/features/health';

// Minimal stand-in for a "db" feature: registers a context value with a query()
// method so the health check's per-feature probe has something to call.
class FakeDbFeature {
    name = 'db';
    async initialize(kernel: Kernel) {
        kernel.getApp().use('*', async (c: any, next: any) => {
            c.set('db', { query: async () => [{ ok: 1 }] });
            await next();
        });
    }
}

describe('Health Check Feature', () => {
    it('reports ok and hides details by default (includeDetails defaults to false)', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new HealthCheckFeature());
        await kernel.initialize();

        const res = await kernel.getApp().request('/health');
        expect(res.status).toBe(200);
        const json = (await res.json()) as any;
        expect(json.status).toBe('ok');
        expect(typeof json.timestamp).toBe('string');
        // Details are off by default; the internal feature list must not leak.
        expect(json.features).toBeUndefined();

        await kernel.shutdown();
    });

    it('exposes the registered feature list when includeDetails is true', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new HealthCheckFeature({ includeDetails: true }));
        await kernel.initialize();

        const json = (await (await kernel.getApp().request('/health')).json()) as any;
        expect(json.status).toBe('ok');
        expect(Array.isArray(json.features)).toBe(true);
        expect(json.features).toContain('health');

        await kernel.shutdown();
    });

    it('probes a registered db feature and reports it healthy', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new FakeDbFeature() as any);
        kernel.registerFeature(new HealthCheckFeature({ includeDetails: true }));
        await kernel.initialize();

        const json = (await (await kernel.getApp().request('/health')).json()) as any;
        expect(json.features).toContain('db');
        expect(json.checks.db).toEqual({ status: 'ok' });

        await kernel.shutdown();
    });

    it('runs custom checks and captures both results and errors', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(
            new HealthCheckFeature({
                includeDetails: true,
                checks: {
                    ok: async () => ({ status: 'ok' }),
                    boom: async () => {
                        throw new Error('nope');
                    },
                },
            }),
        );
        await kernel.initialize();

        const json = (await (await kernel.getApp().request('/health')).json()) as any;
        expect(json.customChecks.ok).toEqual({ status: 'ok' });
        expect(json.customChecks.boom.status).toBe('error');
        // The raw error string must not be serialized to the client.
        expect(json.customChecks.boom.error).toBeUndefined();

        await kernel.shutdown();
    });

    it('responds to readiness and liveness probes', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new HealthCheckFeature());
        await kernel.initialize();
        const app = kernel.getApp();

        const ready = (await (await app.request('/health/ready')).json()) as any;
        expect(ready.status).toBe('ready');

        const live = (await (await app.request('/health/live')).json()) as any;
        expect(live.status).toBe('alive');
        expect(typeof live.uptime).toBe('number');

        await kernel.shutdown();
    });

    it('readiness: returns 200 with no checks registered', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new HealthCheckFeature());
        await kernel.initialize();

        const res = await kernel.getApp().request('/health/ready');
        expect(res.status).toBe(200);
        const json = (await res.json()) as any;
        expect(json.status).toBe('ready');

        await kernel.shutdown();
    });

    it('readiness: returns 200 when all registered checks pass', async () => {
        const feature = new HealthCheckFeature();
        feature.addReadinessCheck('db', async () => true);
        feature.addReadinessCheck('cache', async () => true);

        const kernel = new Kernel();
        kernel.registerFeature(feature);
        await kernel.initialize();

        const res = await kernel.getApp().request('/health/ready');
        expect(res.status).toBe(200);
        const json = (await res.json()) as any;
        expect(json.status).toBe('ready');
        expect(json.checks.db).toBe(true);
        expect(json.checks.cache).toBe(true);

        await kernel.shutdown();
    });

    it('readiness: returns 503 and names failing checks when any check returns false', async () => {
        const feature = new HealthCheckFeature({
            readinessChecks: {
                db: async () => true,
                cache: async () => false,
            },
        });

        const kernel = new Kernel();
        kernel.registerFeature(feature);
        await kernel.initialize();

        const res = await kernel.getApp().request('/health/ready');
        expect(res.status).toBe(503);
        const json = (await res.json()) as any;
        expect(json.status).toBe('not ready');
        expect(json.failed).toContain('cache');
        expect(json.failed).not.toContain('db');
        expect(json.checks.cache).toBe(false);

        await kernel.shutdown();
    });

    it('readiness: returns 503 (not 500) when a check throws', async () => {
        const feature = new HealthCheckFeature();
        feature.addReadinessCheck('broken', async () => {
            throw new Error('connection refused');
        });

        const kernel = new Kernel();
        kernel.registerFeature(feature);
        await kernel.initialize();

        const res = await kernel.getApp().request('/health/ready');
        expect(res.status).toBe(503);
        const json = (await res.json()) as any;
        expect(json.status).toBe('not ready');
        expect(json.failed).toContain('broken');

        await kernel.shutdown();
    });

    it('honors custom probe paths', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(
            new HealthCheckFeature({
                path: '/healthz',
                readinessPath: '/readyz',
                livenessPath: '/livez',
            }),
        );
        await kernel.initialize();
        const app = kernel.getApp();

        expect((await app.request('/healthz')).status).toBe(200);
        expect((await app.request('/readyz')).status).toBe(200);
        expect((await app.request('/livez')).status).toBe(200);

        await kernel.shutdown();
    });
});
