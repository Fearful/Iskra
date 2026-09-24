import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline/promises';
import { ask } from '../src/cli.ts';

const dir = mkdtempSync(join(tmpdir(), 'create-iskra-entry-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Node >= 22.6 runs the TypeScript source directly (--experimental-strip-types). */
function nodeWithTypes(): string | undefined {
    const node = Bun.which('node');
    if (!node) return undefined;
    const [major, minor] = Bun.spawnSync([node, '--version']).stdout.toString().replace(/^v/, '').split('.').map(Number);
    return major! > 22 || (major === 22 && minor! >= 6) ? node : undefined;
}

describe('bin entry point', () => {
    // node_modules/.bin/create-iskra is a link to the real file.
    const link = join(dir, 'create-iskra');
    symlinkSync(join(import.meta.dir, '../src/cli.ts'), link);

    test('runs when invoked through a symlink with Bun (bunx)', () => {
        const result = Bun.spawnSync([process.execPath, link, '--help'], { stdout: 'pipe', stderr: 'pipe' });
        expect(result.exitCode).toBe(0);
        expect(result.stdout.toString()).toContain('--template');
    });

    const node = nodeWithTypes();
    test.if(Boolean(node))('runs when invoked through a symlink with Node (npm create, npx)', () => {
        const result = Bun.spawnSync([node!, '--experimental-strip-types', '--no-warnings', link, '--help'], {
            stdout: 'pipe',
            stderr: 'pipe',
        });
        // Node keeps the link's path in argv[1]; compared with the module's
        // URL it never matched, so the CLI silently did nothing.
        expect(result.exitCode).toBe(0);
        expect(result.stdout.toString()).toContain('--template');
    });
});

describe('prompts', () => {
    function terminal() {
        const input = new PassThrough();
        const output = new PassThrough();
        output.resume();
        const rl = createInterface({ input, output, terminal: true });
        return { input, rl };
    }

    test('Ctrl-C cancels instead of taking the default', async () => {
        const { input, rl } = terminal();
        const answer = ask(rl, 'Directorio del proyecto', 'mi-app');
        input.write('\x03');
        // Readline closed the interface on Ctrl-C, which read as EOF: the
        // default was taken and the project scaffolded anyway.
        expect(await answer).toBeUndefined();
        rl.close();
    });

    test('EOF still takes the default', async () => {
        const { input, rl } = terminal();
        const answer = ask(rl, 'Directorio del proyecto', 'mi-app');
        input.end();
        expect(await answer).toBe('mi-app');
        rl.close();
    });

    test('an answer is trimmed', async () => {
        const { input, rl } = terminal();
        const answer = ask(rl, 'Directorio del proyecto', 'mi-app');
        input.write('  otra-app  \r');
        expect(await answer).toBe('otra-app');
        rl.close();
    });
});
