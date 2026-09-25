import { afterAll, afterEach, describe, expect, it, spyOn } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as migrations from '../src/migrations';
import { MigrationError } from '../src/errors';

const { MigrationHelper } = migrations;

// MigrationHelper and the CLI ran `bunx drizzle-kit`. drizzle-kit is a
// devDependency: where it was not installed (a production install), bunx
// downloaded its latest release from npm and ran it with DATABASE_URL in its
// environment.

const dir = mkdtempSync(join(tmpdir(), 'db-kit-no-drizzle-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function hasDrizzleKitAbove(start: string): boolean {
    for (let d = start; ; d = join(d, '..')) {
        if (existsSync(join(d, 'node_modules', '.bin', 'drizzle-kit'))) return true;
        if (join(d, '..') === d) return false;
    }
}

describe('drizzle-kit: the project install only', () => {
    const cwd = process.cwd();
    let spawnSpy: ReturnType<typeof spyOn> | null = null;

    afterEach(() => {
        process.chdir(cwd);
        spawnSpy?.mockRestore();
        spawnSpy = null;
    });

    it('refuses to migrate where drizzle-kit is not installed, running nothing', async () => {
        expect(hasDrizzleKitAbove(dir)).toBe(false);
        const spawned: string[][] = [];
        spawnSpy = spyOn(Bun, 'spawn').mockImplementation(((cmd: string[]) => {
            spawned.push(cmd);
            return { exited: Promise.resolve(0), stdout: '', stderr: '' };
        }) as any);
        process.chdir(dir);

        const helper = new MigrationHelper({
            dialect: 'postgresql',
            dbUrl: 'postgres://app:secret@db.internal/app',
            schemaPath: './schema.ts',
            migrationsDir: './drizzle',
        });
        for (const run of [() => helper.migrate(), () => helper.generate(), () => helper.push(), () => helper.drop()]) {
            const error = await run().catch((e: unknown) => e);
            expect(error).toBeInstanceOf(MigrationError);
            expect((error as Error).message).toMatch(/drizzle-kit is not installed/);
        }
        expect(spawned).toEqual([]);
    });

    it('runs the installed one with bunx --no-install, hoisted to a parent folder too', () => {
        const project = join(dir, 'monorepo');
        mkdirSync(join(project, 'node_modules', '.bin'), { recursive: true });
        writeFileSync(join(project, 'node_modules', '.bin', 'drizzle-kit'), '');
        mkdirSync(join(project, 'services', 'api'), { recursive: true });

        const { drizzleKitCommand } = migrations;
        expect(drizzleKitCommand(['migrate'], join(project, 'services', 'api'))).toEqual([
            'bunx',
            '--no-install',
            'drizzle-kit',
            'migrate',
        ]);
        expect(() => drizzleKitCommand(['migrate'], dir)).toThrow(MigrationError);
    });

    it('makes the CLI exit 1 before running anything', async () => {
        const proc = Bun.spawn(['bun', 'run', join(import.meta.dir, '../src/cli.ts'), 'migrate'], {
            cwd: dir,
            stdout: 'pipe',
            stderr: 'pipe',
        });
        const [exitCode, stdout, stderr] = await Promise.all([
            proc.exited,
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
        ]);
        expect(exitCode).toBe(1);
        expect(stderr).toContain('drizzle-kit is not installed');
        expect(stdout).not.toContain('> bunx');
    });
});
