import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const CONFIG = join(import.meta.dir, '..', 'src', 'app.config.ts');
const SECRETS = ['RECAPTCHA_SECRET', 'CSRF_SECRET', 'IP_HASH_SECRET'];

/** Loads app.config.ts in a production process with only the given secrets set. */
function loadProductionConfig(secrets: Record<string, string>) {
    const env: Record<string, string | undefined> = { ...process.env, NODE_ENV: 'production' };
    for (const name of SECRETS) delete env[name];
    const code = `const { config } = await import(${JSON.stringify(CONFIG)}); console.log(JSON.stringify(config));`;
    const proc = Bun.spawnSync([process.execPath, '-e', code], { env: { ...env, ...secrets } });
    return { ok: proc.exitCode === 0, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

describe('forms-api configuration in production', () => {
    it('refuses to start without its secrets', () => {
        const { ok, stderr } = loadProductionConfig({});
        expect(ok).toBe(false);
        expect(stderr).toContain('RECAPTCHA_SECRET must be set in production');
    });

    it('does not use CSRF_SECRET as the IP hash key', () => {
        // IP_HASH_SECRET used to fall back to CSRF_SECRET.
        const { ok, stderr } = loadProductionConfig({ RECAPTCHA_SECRET: 'r', CSRF_SECRET: 'c'.repeat(44) });
        expect(ok).toBe(false);
        expect(stderr).toContain('IP_HASH_SECRET must be set in production');
    });

    it('refuses a development default', () => {
        const { ok, stderr } = loadProductionConfig({
            RECAPTCHA_SECRET: 'r',
            CSRF_SECRET: 'dev-csrf-secret-change-me-32-characters',
            IP_HASH_SECRET: 'i'.repeat(44),
        });
        expect(ok).toBe(false);
        expect(stderr).toContain('CSRF_SECRET must be set in production');
    });

    it('starts with every secret set', () => {
        const { ok, stdout, stderr } = loadProductionConfig({
            RECAPTCHA_SECRET: 'r',
            CSRF_SECRET: 'c'.repeat(44),
            IP_HASH_SECRET: 'i'.repeat(44),
        });
        expect(stderr).toBe('');
        expect(ok).toBe(true);
        const config = JSON.parse(stdout);
        expect(config.csrf.secret).toBe('c'.repeat(44));
        expect(config.ipHashSecret).toBe('i'.repeat(44));
        expect(config.recaptcha.hostnames).toEqual([]);
    });

    it('reads the reCAPTCHA hostnames as a comma-separated list', () => {
        const { stdout } = loadProductionConfig({
            RECAPTCHA_SECRET: 'r',
            CSRF_SECRET: 'c'.repeat(44),
            IP_HASH_SECRET: 'i'.repeat(44),
            RECAPTCHA_HOSTNAMES: ' Forms.Example.com, ,www.example.com',
        });
        expect(JSON.parse(stdout).recaptcha.hostnames).toEqual(['forms.example.com', 'www.example.com']);
    });
});
