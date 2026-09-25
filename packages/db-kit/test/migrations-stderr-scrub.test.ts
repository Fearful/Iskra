import { describe, it, expect, afterEach, spyOn } from 'bun:test';
import { MigrationHelper } from '../src/migrations';
import { MigrationError } from '../src/errors';

/**
 * HIGH finding (src/migrations.ts:100): raw drizzle-kit stderr is stored verbatim
 * in MigrationError.context.stderr. drizzle-kit echoes the connection string —
 * including `user:password@host` — on failure, so plaintext credentials leak into
 * structured logs, bypassing the scrubUrl redaction used in driver.ts.
 *
 * These tests pin the FIXED behavior: any `//user:pass@` embedded in stderr must be
 * redacted (e.g. via scrubUrl / a `//***:***@` regex) before being stored on the
 * MigrationError context. They fail today because stderr is stored with `.trim()`
 * only.
 */
describe('MigrationHelper stderr credential scrubbing', () => {
    let spawnSpy: ReturnType<typeof spyOn> | null = null;

    function mockSpawn(result: { exitCode?: number; stdout?: string; stderr?: string }) {
        spawnSpy = spyOn(Bun, 'spawn').mockImplementation(((_cmd: string[], _opts: any) => {
            return {
                exited: Promise.resolve(result.exitCode ?? 0),
                stdout: result.stdout ?? '',
                stderr: result.stderr ?? '',
            };
        }) as any);
    }

    afterEach(() => {
        spawnSpy?.mockRestore();
        spawnSpy = null;
    });

    const helper = () =>
        new MigrationHelper({
            dialect: 'postgresql',
            dbUrl: 'postgres://leakuser:leakpass@db.internal:5432/app',
            schemaPath: './schema.ts',
            migrationsDir: './drizzle',
        });

    it('redacts the password from a credential URL embedded in stderr', async () => {
        const stderr = 'Error: connection failed for postgres://leakuser:leakpass@db.internal:5432/app';
        mockSpawn({ exitCode: 1, stderr });

        try {
            await helper().migrate();
            expect(true).toBe(false); // should not reach
        } catch (err) {
            expect(err).toBeInstanceOf(MigrationError);
            const stored = (err as MigrationError).context?.stderr as string;
            expect(stored).toBeDefined();
            expect(stored).not.toContain('leakpass');
            expect(stored).not.toContain('leakuser');
        }
    });

    it('preserves the non-credential portion of stderr after scrubbing', async () => {
        const stderr = 'schema drift detected at mysql://admin:hunter2@mysql.host:3306/db near table users';
        mockSpawn({ exitCode: 1, stderr });

        try {
            await helper().migrate();
            expect(true).toBe(false);
        } catch (err) {
            const stored = (err as MigrationError).context?.stderr as string;
            expect(stored).not.toContain('hunter2');
            expect(stored).not.toContain('admin');
            // The diagnostic message itself must survive so the error stays useful.
            expect(stored).toContain('schema drift detected');
            expect(stored).toContain('table users');
            // Redaction marker present where the creds used to be.
            expect(stored).toContain('***');
        }
    });

    it('leaves stderr without credentials unchanged', async () => {
        const stderr = 'schema drift detected near table users';
        mockSpawn({ exitCode: 1, stderr });

        try {
            await helper().migrate();
            expect(true).toBe(false);
        } catch (err) {
            const stored = (err as MigrationError).context?.stderr as string;
            expect(stored).toBe('schema drift detected near table users');
        }
    });
});
