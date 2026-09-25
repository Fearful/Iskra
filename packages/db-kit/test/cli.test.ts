import { describe, test, expect } from 'bun:test';

// cli.ts parses process.argv at module load and calls process.exit, so it is
// exercised as a subprocess rather than imported. We assert on exit codes and
// the help/echo output for each command-parsing branch. drizzle-kit is never
// actually reached for the invalid/help branches (they exit first); for valid
// commands we only inspect the echoed command line, not drizzle execution.

const CLI = `${import.meta.dir}/../src/cli.ts`;

async function runCli(args: string[]) {
    const proc = Bun.spawn(['bun', 'run', CLI, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
        // Empty cwd config dir is fine — valid commands echo before spawning drizzle.
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    return { exitCode, stdout };
}

describe('db-kit CLI argument parsing', () => {
    test('exits 0 and prints help when no command is given', async () => {
        const { exitCode, stdout } = await runCli([]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain('Iskra DB Kit');
        expect(stdout).toContain('Comandos:');
    });

    test('exits 1 and prints help for an unknown command', async () => {
        const { exitCode, stdout } = await runCli(['bogus']);
        expect(exitCode).toBe(1);
        expect(stdout).toContain('Iskra DB Kit');
    });

    test("accepts 'generate' and echoes the drizzle-kit invocation", async () => {
        const { stdout } = await runCli(['generate']);
        // The valid-command branch echoes `> bunx --no-install drizzle-kit <command> ...`.
        expect(stdout).toContain('bunx --no-install drizzle-kit generate');
    });

    test('forwards extra args after a valid command (e.g. a migration name)', async () => {
        const { stdout } = await runCli(['generate', 'add_users_table']);
        expect(stdout).toContain('bunx --no-install drizzle-kit generate add_users_table');
    });

    test('accepts each of the four valid commands', async () => {
        for (const cmd of ['generate', 'migrate', 'push', 'drop']) {
            const { stdout } = await runCli([cmd]);
            expect(stdout).toContain(`bunx --no-install drizzle-kit ${cmd}`);
        }
    });
});
