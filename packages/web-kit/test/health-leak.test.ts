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
});
