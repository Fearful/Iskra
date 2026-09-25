import { describe, it, expect } from 'bun:test';
import { Kernel } from '../src/kernel';
import { HealthCheckFeature } from '../src/features/health';

// RED tests for the HIGH "health leak" finding (src/features/health.ts:19,67,87).
//
// The unauthenticated /health endpoint currently defaults includeDetails to
// true, so it returns the full feature list and embeds raw String(error) text
// from db/cache/custom checks. The fix must:
//   1. Default includeDetails to FALSE (no details on an unauthenticated probe).
//   2. Never return raw error strings to clients (log them; return a generic
//      status only).
//
// A health probe that registers a custom check which throws a recognizable
// secret in its message lets us assert the secret never reaches the client.
const SECRET_MARKER = 'CONNECTION_STRING_postgres://user:p4ss@db:5432/app';

describe('Health Check Feature — leak hardening', () => {
    it('hides details by default (includeDetails defaults to false)', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new HealthCheckFeature());
        await kernel.initialize();

        const res = await kernel.getApp().request('/health');
        expect(res.status).toBe(200);
        const json = (await res.json()) as any;

        expect(json.status).toBe('ok');
        // With details off by default, the internal feature list must not leak.
        expect(json.features).toBeUndefined();
        expect(json.checks).toBeUndefined();
        expect(json.customChecks).toBeUndefined();

        await kernel.shutdown();
    });

    it('never embeds raw error strings in the client response', async () => {
        const kernel = new Kernel();
        // Force details ON so the check logic runs; even then the raw error text
        // must not be serialized to the client.
        kernel.registerFeature(
            new HealthCheckFeature({
                includeDetails: true,
                checks: {
                    boom: async () => {
                        throw new Error(SECRET_MARKER);
                    },
                },
            }),
        );
        await kernel.initialize();

        const res = await kernel.getApp().request('/health');
        const bodyText = await res.text();

        // The raw error string (and any embedded connection string) must never
        // reach the client. A generic "error" status is acceptable; leaking the
        // exception message is not.
        expect(bodyText).not.toContain(SECRET_MARKER);
        expect(bodyText).not.toContain('p4ss');

        await kernel.shutdown();
    });

    it('keeps readiness check names out of /health/ready by default', async () => {
        // Names can describe the infrastructure; the status code tells an
        // orchestrator all it needs.
        const warnings: string[] = [];
        const logger = { debug() {}, info() {}, error() {}, warn: (msg: string) => warnings.push(msg) };
        const failing = new Kernel({ logger });
        failing.registerFeature(
            new HealthCheckFeature({
                readinessChecks: { 'postgres-primary-10.0.3.12': async () => false, cache: async () => true },
            }),
        );
        await failing.initialize();

        const res = await failing.getApp().request('/health/ready');
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ status: 'not ready' });
        // The operator still finds out which one failed.
        expect(warnings).toEqual(['Readiness checks failed: postgres-primary-10.0.3.12']);

        const passing = new Kernel({ logger: false });
        passing.registerFeature(new HealthCheckFeature({ readinessChecks: { 'redis-10.0.3.13': async () => true } }));
        await passing.initialize();
        expect(await (await passing.getApp().request('/health/ready')).json()).toEqual({ status: 'ready' });

        await failing.shutdown();
        await passing.shutdown();
    });

    it('keeps the uptime out of /health/live by default', async () => {
        const kernel = new Kernel({ logger: false });
        kernel.registerFeature(new HealthCheckFeature());
        await kernel.initialize();

        const live = (await (await kernel.getApp().request('/health/live')).json()) as any;
        expect(live.status).toBe('alive');
        expect(live.uptime).toBeUndefined();

        await kernel.shutdown();
    });
});
