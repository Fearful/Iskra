import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A bundled app (`bun build`, `bun build --compile`) has no node_modules to
// load packages from at runtime. The dev logger used a pino `transport`, whose
// worker loads pino-pretty by name, so bundled apps crashed at startup unless
// NODE_ENV=production.
describe('createLogger in a bundle', () => {
    it('logs outside production without node_modules', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'iskra-logger-'));
        try {
            const entry = join(dir, 'entry.ts');
            writeFileSync(
                entry,
                `import { createLogger } from ${JSON.stringify(join(import.meta.dir, '../src/logger/index.ts'))};\n` +
                    `createLogger('bundled').info('hello from a bundle');\n`,
            );
            const build = await Bun.build({ entrypoints: [entry], outdir: join(dir, 'out'), target: 'bun' });
            expect(build.success).toBe(true);

            const proc = Bun.spawn([process.execPath, join(dir, 'out', 'entry.js')], {
                cwd: dir,
                env: { ...process.env, NODE_ENV: 'development' },
                stdout: 'pipe',
                stderr: 'pipe',
            });
            const [stdout, stderr, code] = await Promise.all([
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
                proc.exited,
            ]);
            expect(stderr).not.toContain('error');
            expect(code).toBe(0);
            expect(stdout).toContain('hello from a bundle');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }, 30_000);
});
