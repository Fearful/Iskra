import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';

// Boot test: runs the template as `bun start` does and checks it gets through
// startup. Outside Tauri the bridge and menu are stubs, and nothing keeps the
// process alive, so it exits once started: that exit must be clean.
describe('desktop-app boots', () => {
    it('starts, wires the stubbed bridge and menu, and exits 0', async () => {
        const proc = Bun.spawn([process.execPath, 'src/main.ts'], {
            cwd: join(import.meta.dir, '..'),
            env: { ...process.env, NODE_ENV: 'production' },
            stdout: 'pipe',
            stderr: 'pipe',
        });
        const [out, err, code] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ]);
        expect(err).not.toContain('Fallo al arrancar');
        expect(code).toBe(0);
        expect(out).toContain('App started successfully');
        expect(out).toContain('setupMenu');
        expect(out).toContain('Iskra Desktop App iniciada');
    }, 20_000);
});
