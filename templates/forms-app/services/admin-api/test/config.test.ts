import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const CONFIG = join(import.meta.dir, '..', 'src', 'app.config.ts');

/** Loads app.config.ts in a production process with only the given secrets set. */
function loadProductionConfig(secrets: Record<string, string>) {
    const env: Record<string, string | undefined> = { ...process.env, NODE_ENV: 'production' };
    delete env.AUTH_SECRET;
    delete env.INTERNAL_API_TOKEN;
    const code = `const { config } = await import(${JSON.stringify(CONFIG)}); console.log(JSON.stringify(config));`;
    const proc = Bun.spawnSync([process.execPath, '-e', code], { env: { ...env, ...secrets } });
    return { ok: proc.exitCode === 0, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

describe('admin-api configuration in production', () => {
    it('refuses to start without AUTH_SECRET', () => {
        // It used to fall back to a secret written in this repository, which
        // is enough to sign an admin session.
        const { ok, stderr } = loadProductionConfig({});
        expect(ok).toBe(false);
        expect(stderr).toContain('AUTH_SECRET must be set in production');
    });

    it('refuses the development AUTH_SECRET', () => {
        const { ok, stderr } = loadProductionConfig({ AUTH_SECRET: 'dev-secret-change-me-min-32-characters-long' });
        expect(ok).toBe(false);
        expect(stderr).toContain('AUTH_SECRET must be set in production');
    });

    it("refuses to start without form-manager's INTERNAL_API_TOKEN", () => {
        const { ok, stderr } = loadProductionConfig({ AUTH_SECRET: 'a'.repeat(44) });
        expect(ok).toBe(false);
        expect(stderr).toContain('INTERNAL_API_TOKEN must be set in production');
    });

    it('starts with its secrets set', () => {
        const { ok, stdout, stderr } = loadProductionConfig({
            AUTH_SECRET: 'a'.repeat(44),
            INTERNAL_API_TOKEN: 't'.repeat(44),
        });
        expect(stderr).toBe('');
        expect(ok).toBe(true);
        expect(JSON.parse(stdout).auth.secret).toBe('a'.repeat(44));
        expect(JSON.parse(stdout).internalApiToken).toBe('t'.repeat(44));
    });
});
