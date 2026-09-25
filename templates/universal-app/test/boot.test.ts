import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';

// Boot test: runs the template as `bun start` does, once per platform branch,
// and checks the shared note logic ran. The platform drivers are placeholders
// that keep nothing alive, so the process exits once done: cleanly.
async function run(platform: 'desktop' | 'mobile') {
    const proc = Bun.spawn([process.execPath, 'src/main.ts'], {
        cwd: join(import.meta.dir, '..'),
        env: { ...process.env, NODE_ENV: 'production', FORCE_PLATFORM: platform },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return { out, code };
}

describe('universal-app boots', () => {
    it('on the desktop branch', async () => {
        const { out, code } = await run('desktop');
        expect(code).toBe(0);
        expect(out).toContain('Universal App lista');
        expect(out).toContain('Nota creada (escritorio)');
    }, 20_000);

    it('on the mobile branch', async () => {
        const { out, code } = await run('mobile');
        expect(code).toBe(0);
        expect(out).toContain('Universal App lista');
        expect(out).toContain('Nota creada (movil)');
    }, 20_000);
});
