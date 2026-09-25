import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';

const VITE = 'http://localhost:5173';
const NGINX = 'http://localhost';
const OTHER = 'http://evil.example';

async function signInStatuses(nodeEnv: string): Promise<Record<string, number>> {
    const proc = Bun.spawn(
        [process.execPath, join(import.meta.dir, 'fixtures', 'origin-probe.ts'), VITE, NGINX, OTHER],
        {
            // Defaults only: no CORS_ORIGINS / AUTH_BASE_URL from the environment.
            env: { ...process.env, NODE_ENV: nodeEnv, CORS_ORIGINS: '', AUTH_BASE_URL: '' },
            stdout: 'pipe',
            stderr: 'inherit',
        },
    );
    const out = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    return JSON.parse(out.trim().split('\n').pop()!);
}

describe('admin-api trusted origins (default config)', () => {
    it('accepts sign-in from the Vite dev server outside production', async () => {
        // Regression: the documented `bun dev` flow (admin-frontend on :5173)
        // got 403 INVALID_ORIGIN on every sign-in, shown as "Invalid email or password".
        const status = await signInStatuses('development');
        expect(status[VITE]).not.toBe(403);
        expect(status[NGINX]).not.toBe(403);
        expect(status[OTHER]).toBe(403);
    }, 20_000);

    it("trusts only nginx's origin in production", async () => {
        const status = await signInStatuses('production');
        expect(status[VITE]).toBe(403);
        expect(status[NGINX]).not.toBe(403);
        expect(status[OTHER]).toBe(403);
    }, 20_000);
});
