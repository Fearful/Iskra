import { describe, expect, it } from 'bun:test';
import { Kernel } from '../src/kernel';
import { HealthCheckFeature } from '../src/features/health';
import { RateLimitFeature } from '../src/features/rate-limit';
import type { HealthReport } from '../src/types';

async function kernelWith(...features: ConstructorParameters<typeof HealthCheckFeature>[0][]) {
    const kernel = new Kernel({ logger: false });
    for (const config of features) kernel.registerFeature(new HealthCheckFeature(config));
    await kernel.initialize();
    return kernel;
}

describe('HealthCheckFeature custom bodies', () => {
    it('answers the liveness probe with the body the app sets', async () => {
        const kernel = await kernelWith({
            path: false,
            readinessPath: '/healthcheck/ready',
            livenessPath: '/healthcheck/live',
            body: { live: () => ({ message: 'ok' }) },
        });

        const res = await kernel.getApp().request('/healthcheck/live');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ message: 'ok' });
        await kernel.shutdown();
    });

    it('keeps 503 for a failed readiness check and gives the body the report', async () => {
        const reports: HealthReport[] = [];
        const kernel = await kernelWith({
            readinessChecks: { oracle: async () => false, kv: async () => true },
            body: {
                ready: (report) => {
                    reports.push(report);
                    return { message: report.ok ? 'ok' : 'unavailable' };
                },
            },
        });

        const res = await kernel.getApp().request('/health/ready');
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ message: 'unavailable' });
        expect(reports[0]).toMatchObject({
            endpoint: 'ready',
            ok: false,
            failed: ['oracle'],
            checks: { oracle: { status: 'error' }, kv: { status: 'ok' } },
        });
        await kernel.shutdown();
    });

    it('passes the db probe and custom checks to the /health body', async () => {
        let report: HealthReport | undefined;
        const kernel = await kernelWith({
            checks: { queue: async () => ({ status: 'error', message: 'stalled' }) },
            body: {
                health: (r) => {
                    report = r;
                    return { healthy: r.ok };
                },
            },
        });

        const res = await kernel.getApp().request('/health');
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ healthy: false });
        expect(report?.checks.queue).toEqual({ status: 'error', message: 'stalled' });
        expect(report?.failed).toEqual(['queue']);
        await kernel.shutdown();
    });

    it('sends a Response from the body function as is', async () => {
        const kernel = await kernelWith({
            body: { live: () => new Response('OK', { status: 200, headers: { 'content-type': 'text/plain' } }) },
        });

        const res = await kernel.getApp().request('/health/live');
        expect(res.headers.get('content-type')).toBe('text/plain');
        expect(await res.text()).toBe('OK');
        await kernel.shutdown();
    });
});

describe('HealthCheckFeature disabled endpoints', () => {
    it('does not serve an endpoint set to false', async () => {
        const kernel = await kernelWith({ path: false, readinessPath: false });
        const app = kernel.getApp();

        expect((await app.request('/health')).status).toBe(404);
        expect((await app.request('/health/ready')).status).toBe(404);
        expect((await app.request('/health/live')).status).toBe(200);
        expect(kernel.getFeature('health')?.paths).toEqual(['/health/live']);
        await kernel.shutdown();
    });

    it('leaves only the served endpoints out of the rate limit', async () => {
        const kernel = new Kernel({ logger: false });
        kernel.registerFeature(new HealthCheckFeature({ path: false, livenessPath: '/healthcheck/live' }));
        kernel.registerFeature(new RateLimitFeature({ max: 1, windowMs: 60_000 }));
        await kernel.initialize();
        const app = kernel.getApp();

        for (let i = 0; i < 3; i++) {
            expect((await app.request('/healthcheck/live')).status).toBe(200);
        }
        expect((await app.request('/health')).status).toBe(404);
        expect((await app.request('/health')).status).toBe(429);
        await kernel.shutdown();
    });
});

describe('HealthCheckFeature.addCheck', () => {
    it('adds a check to /health and refuses a name already taken', async () => {
        const health = new HealthCheckFeature({ includeDetails: true, checks: { db: async () => ({ status: 'ok' }) } });
        health.addCheck('jobs', async () => ({ status: 'error', details: { failures: 3 } }));
        expect(() => health.addCheck('db', async () => ({ status: 'ok' }))).toThrow('already registered');

        const kernel = new Kernel({ logger: false });
        kernel.registerFeature(health);
        await kernel.initialize();
        const res = await kernel.getApp().request('/health');
        expect(res.status).toBe(503);
        const body = (await res.json()) as { customChecks: Record<string, unknown> };
        expect(body.customChecks).toEqual({
            db: { status: 'ok' },
            jobs: { status: 'error', details: { failures: 3 } },
        });
        await kernel.shutdown();
    });
});
