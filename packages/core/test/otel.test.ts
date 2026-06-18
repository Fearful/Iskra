import { describe, it, expect } from 'bun:test';
import { initOtel, shutdownOtel } from '../src/otel';
import type { OtelConfig } from '../src/types';

// The OTel SDK packages are optional peer deps. Detect whether they are
// actually installed so the "not installed" assertions only run when relevant.
async function otelInstalled(): Promise<boolean> {
    try {
        // Indirect the specifier so tsc does not statically resolve this
        // optional peer dep (matches the pattern used in src/otel.ts).
        const specifier = '@opentelemetry/sdk-node';
        await import(specifier);
        return true;
    } catch {
        return false;
    }
}

describe('OTel initialization', () => {
    it('throws a helpful error when OTel packages are not installed', async () => {
        if (await otelInstalled()) return;

        const config: OtelConfig = { enabled: true, endpoint: 'http://localhost:4318' };

        await expect(initOtel(config, 'TestApp')).rejects.toThrow(/not installed/i);
    });

    it('error message tells the user how to install the packages', async () => {
        if (await otelInstalled()) return;

        try {
            await initOtel({ enabled: true }, 'TestApp');
            throw new Error('initOtel should have thrown');
        } catch (err: any) {
            expect(err.message).toContain('bun add');
            expect(err.message).toContain('@opentelemetry/sdk-node');
        }
    });

    it('shutdownOtel is a safe no-op when nothing was initialized', async () => {
        await expect(shutdownOtel()).resolves.toBeUndefined();
    });
});
