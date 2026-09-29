import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MigrationError } from '../src/errors';
import { splitStatements } from '../src/migrations';
import { oraError, startedDriver, type Call } from './fakes';

describe('splitStatements', () => {
    test('SQL statements end with ; and comments go', () => {
        const source = `-- users
CREATE TABLE users (
    id NUMBER PRIMARY KEY, -- the key; not the end
    name VARCHAR2(100) DEFAULT 'a;b'
);
/* seed */ INSERT INTO users (id, name) VALUES (1, 'it''s; fine');
CREATE INDEX users_name ON users (name)`;
        expect(splitStatements(source)).toEqual([
            `CREATE TABLE users (\n    id NUMBER PRIMARY KEY, -- the key; not the end\n    name VARCHAR2(100) DEFAULT 'a;b'\n)`,
            `INSERT INTO users (id, name) VALUES (1, 'it''s; fine')`,
            'CREATE INDEX users_name ON users (name)',
        ]);
    });

    test('PL/SQL blocks run to a / line and keep their semicolons', () => {
        const source = `CREATE TABLE audit_log (msg VARCHAR2(200));

CREATE OR REPLACE TRIGGER users_audit
AFTER INSERT ON users FOR EACH ROW
BEGIN
    INSERT INTO audit_log (msg) VALUES ('new user');
END;
/

begin
  null;
end;
/
CREATE TABLE t2 (x NUMBER)
/
`;
        expect(splitStatements(source)).toEqual([
            'CREATE TABLE audit_log (msg VARCHAR2(200))',
            "CREATE OR REPLACE TRIGGER users_audit\nAFTER INSERT ON users FOR EACH ROW\nBEGIN\n    INSERT INTO audit_log (msg) VALUES ('new user');\nEND;",
            'begin\n  null;\nend;',
            'CREATE TABLE t2 (x NUMBER)',
        ]);
    });

    test('Windows line endings, and a file of comments only', () => {
        expect(splitStatements('SELECT 1 FROM DUAL;\r\n/\r\nSELECT 2 FROM DUAL\r\n')).toEqual([
            'SELECT 1 FROM DUAL',
            'SELECT 2 FROM DUAL',
        ]);
        expect(splitStatements('-- nothing\n/* here */\n')).toEqual([]);
    });
});

describe('OracleDriver.runMigrations', () => {
    let dir: string;

    afterEach(() => {
        if (dir) rmSync(dir, { recursive: true, force: true });
    });

    function migrations(files: Record<string, string>) {
        dir = mkdtempSync(join(tmpdir(), 'iskra-oracle-migrations-'));
        for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
        return dir;
    }

    /** A database that already has the tables and `applied` recorded. */
    function database(applied: Record<string, string> = {}, fail?: (call: Call) => Error | undefined) {
        return (call: Call) => {
            const failure = fail?.(call);
            if (failure) return failure;
            if (call.sql.startsWith('CREATE TABLE ISKRA_MIGRATIONS')) return oraError(955, 'name is already used');
            if (call.sql.startsWith('SELECT name, checksum')) {
                return { rows: Object.entries(applied).map(([NAME, CHECKSUM]) => ({ NAME, CHECKSUM })) };
            }
            return { rows: [] };
        };
    }

    test('applies pending files in numeric order, each with its record and a commit', async () => {
        const { driver, pool } = await startedDriver();
        pool.respond = database();
        const path = migrations({
            '10_last.sql': 'CREATE TABLE c (x NUMBER);',
            '2_second.sql': 'CREATE TABLE b (x NUMBER);\nINSERT INTO b VALUES (1);',
            '1_first.sql': 'CREATE TABLE a (x NUMBER)',
            'notes.txt': 'not a migration',
        });
        expect(await driver.runMigrations(path)).toEqual(['1_first.sql', '2_second.sql', '10_last.sql']);
        expect(pool.statements).toEqual([
            expect.stringMatching(/^CREATE TABLE ISKRA_MIGRATIONS \(name VARCHAR2\(255\) PRIMARY KEY/),
            'CREATE TABLE ISKRA_MIGRATIONS_LOCK (id NUMBER PRIMARY KEY)',
            'LOCK TABLE ISKRA_MIGRATIONS_LOCK IN EXCLUSIVE MODE WAIT 60',
            'SELECT name, checksum FROM ISKRA_MIGRATIONS',
            'CREATE TABLE a (x NUMBER)',
            'INSERT INTO ISKRA_MIGRATIONS (name, checksum) VALUES (:name, :checksum)',
            'CREATE TABLE b (x NUMBER)',
            'INSERT INTO b VALUES (1)',
            'INSERT INTO ISKRA_MIGRATIONS (name, checksum) VALUES (:name, :checksum)',
            'CREATE TABLE c (x NUMBER)',
            'INSERT INTO ISKRA_MIGRATIONS (name, checksum) VALUES (:name, :checksum)',
        ]);
        // The lock and the migrations run on two standalone connections, autoCommit off.
        const [lock, work] = driver.standalone;
        expect(pool.calls.filter((c) => c.sql.startsWith('LOCK'))[0]!.connection).toBe(lock!);
        expect(pool.calls.filter((c) => c.sql.startsWith('CREATE TABLE a'))[0]!.connection).toBe(work!);
        expect(pool.calls.slice(1).every((c) => c.options.autoCommit === false)).toBe(true);
        expect(work!.commits).toBe(3);
        expect([lock!.rollbacks, lock!.closed, work!.closed]).toEqual([1, 1, 1]);
    });

    test('skips applied files and refuses one that changed', async () => {
        const { driver, pool } = await startedDriver();
        const path = migrations({ '1_a.sql': 'CREATE TABLE a (x NUMBER)', '2_b.sql': 'CREATE TABLE b (x NUMBER)' });

        // Record 1_a.sql with its real checksum by applying it first.
        pool.respond = database();
        await driver.runMigrations(path);
        const checksum = (pool.calls.find((c) => c.sql.startsWith('INSERT INTO ISKRA'))!.binds as { checksum: string })
            .checksum;

        pool.calls = [];
        pool.respond = database({ '1_a.sql': checksum });
        expect(await driver.runMigrations(path)).toEqual(['2_b.sql']);
        expect(pool.statements).not.toContain('CREATE TABLE a (x NUMBER)');

        pool.respond = database({ '1_a.sql': 'something else' });
        await expect(driver.runMigrations(path)).rejects.toThrow('Migration 1_a.sql changed after it was applied');
    });

    test('a failing statement rolls back and names the file and statement', async () => {
        const { driver, pool } = await startedDriver();
        pool.respond = database({}, ({ sql }) =>
            sql.startsWith('INSERT INTO b') ? oraError(942, 'table or view does not exist') : undefined,
        );
        const path = migrations({ '1_b.sql': 'CREATE TABLE b0 (x NUMBER);\nINSERT INTO b VALUES (1);' });
        const error = (await driver.runMigrations(path).catch((e: unknown) => e)) as MigrationError;
        expect(error).toBeInstanceOf(MigrationError);
        expect(error.message).toBe('Migration 1_b.sql failed at statement 2: ORA-00942: table or view does not exist');
        expect(error.context).toEqual({ migration: '1_b.sql', statement: 2 });
        const [lock, work] = driver.standalone;
        expect([work!.rollbacks, work!.commits, work!.closed, lock!.closed]).toEqual([1, 0, 1, 1]);
    });

    test('PL/SQL created with compilation errors fails the migration with its USER_ERRORS, unrecorded', async () => {
        const { driver, pool } = await startedDriver();
        const base = database();
        pool.respond = (call) => {
            if (call.sql.startsWith('CREATE OR REPLACE PROCEDURE')) {
                return { warning: { code: 'NJS-700', message: 'NJS-700: creation succeeded with compilation errors' } };
            }
            if (call.sql.includes('FROM user_errors')) {
                return { rows: [{ LINE: 3, POSITION: 5, TEXT: "PLS-00201: identifier 'NOPE' must be declared\n" }] };
            }
            return base(call);
        };
        const path = migrations({
            '1_proc.sql': 'CREATE OR REPLACE PROCEDURE broken_proc IS\nBEGIN\n    nope;\nEND;\n/\n',
        });
        const error = (await driver.runMigrations(path).catch((e: unknown) => e)) as MigrationError;
        expect(error).toBeInstanceOf(MigrationError);
        expect(error.message).toBe(
            'Migration 1_proc.sql failed at statement 1: NJS-700: creation succeeded with compilation errors: ' +
                "PROCEDURE BROKEN_PROC (line 3, column 5: PLS-00201: identifier 'NOPE' must be declared)",
        );
        expect(error.context).toMatchObject({ migration: '1_proc.sql', statement: 1, compilationErrors: true });
        expect(pool.calls.find((c) => c.sql.includes('FROM user_errors'))!.binds).toEqual({
            name: 'BROKEN_PROC',
            type: 'PROCEDURE',
        });
        expect(pool.statements.some((sql) => sql.startsWith('INSERT INTO ISKRA_MIGRATIONS'))).toBe(false);
    });

    test('another runner holding the lock past lockTimeout', async () => {
        const { driver, pool } = await startedDriver();
        pool.respond = database({}, ({ sql }) =>
            sql.startsWith('LOCK TABLE')
                ? oraError(30006, 'resource busy; acquire with WAIT timeout expired')
                : undefined,
        );
        const path = migrations({ '1_a.sql': 'CREATE TABLE a (x NUMBER)' });
        await expect(driver.runMigrations(path, { lockTimeout: 5 })).rejects.toThrow(
            'Another process is running migrations (waited 5s for ISKRA_MIGRATIONS_LOCK)',
        );
        expect(pool.calls.find((c) => c.sql.startsWith('LOCK'))!.sql).toEndWith('WAIT 5');
    });

    test('options and preconditions', async () => {
        const { driver, pool } = await startedDriver();
        pool.respond = database();
        const path = migrations({ '1_a.sql': 'CREATE TABLE a (x NUMBER)' });
        await driver.runMigrations(path, { table: 'app_schema_versions' });
        expect(pool.statements).toContain('LOCK TABLE APP_SCHEMA_VERSIONS_LOCK IN EXCLUSIVE MODE WAIT 60');
        await expect(driver.runMigrations(path, { table: 'x; DROP TABLE users' })).rejects.toThrow(
            'Invalid migrations table name',
        );
        await expect(driver.runMigrations(join(path, 'missing'))).rejects.toThrow('Migrations directory not found');
        await driver.stop();
        await expect(driver.runMigrations(path)).rejects.toThrow('the Oracle driver is not started');
    });
});
