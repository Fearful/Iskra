import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { App } from '@iskra-bun/core';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OracleDriver } from '../src/driver';
import { MigrationError } from '../src/errors';
import { ORACLE, oracleUp } from './oracle-env';

// runMigrations() against a real database, with a migrations table of its own
// (ISKRA_IT_MIGRATIONS) so it does not touch an app's. Skipped unless the
// database in oracle-env.ts is reachable; the `oracle` CI job provides one.
setDefaultTimeout(60_000);

const up = await oracleUp();
const TABLE = 'ISKRA_IT_MIGRATIONS';
const DROP = ['ISKRA_IT_M_ITEMS', 'ISKRA_IT_M_OTHER', TABLE, `${TABLE}_LOCK`];

async function startDriver() {
    const driver = new OracleDriver();
    await driver.init(new App({ name: 'OracleMigrations', logger: { level: 'silent' }, oracle: ORACLE }));
    await driver.start();
    return driver;
}

(up ? describe : describe.skip)('OracleDriver.runMigrations (real Oracle)', () => {
    let oracle: OracleDriver;
    let dir: string;

    async function dropAll() {
        for (const table of DROP) {
            await oracle.execute(
                `BEGIN EXECUTE IMMEDIATE 'DROP TABLE ${table} CASCADE CONSTRAINTS PURGE';
                 EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;`,
            );
        }
    }

    beforeAll(async () => {
        oracle = await startDriver();
        await dropAll();
        dir = mkdtempSync(join(tmpdir(), 'iskra-oracle-it-'));
        writeFileSync(
            join(dir, '001_items.sql'),
            `-- The items table and its index.
CREATE TABLE iskra_it_m_items (
    id   NUMBER PRIMARY KEY,
    name VARCHAR2(50) NOT NULL
);
CREATE INDEX iskra_it_m_items_name ON iskra_it_m_items (name);
`,
        );
        writeFileSync(
            join(dir, '002_trigger.sql'),
            `CREATE OR REPLACE TRIGGER iskra_it_m_items_upper
BEFORE INSERT ON iskra_it_m_items FOR EACH ROW
BEGIN
    :NEW.name := UPPER(:NEW.name);
END;
/
INSERT INTO iskra_it_m_items (id, name) VALUES (1, 'uno');
INSERT INTO iskra_it_m_items (id, name) VALUES (2, 'it''s; two');
`,
        );
    });

    afterAll(async () => {
        if (dir) rmSync(dir, { recursive: true, force: true });
        if (!oracle) return;
        await dropAll().catch(() => {});
        await oracle.stop();
    });

    test('applies the files once, PL/SQL included', async () => {
        expect(await oracle.runMigrations(dir, { table: TABLE })).toEqual(['001_items.sql', '002_trigger.sql']);
        expect(await oracle.query(`SELECT id, name FROM iskra_it_m_items ORDER BY id`)).toEqual([
            { ID: 1, NAME: 'UNO' },
            { ID: 2, NAME: "IT'S; TWO" },
        ]);
        const recorded = await oracle.query<{ NAME: string }>(`SELECT name FROM ${TABLE} ORDER BY name`);
        expect(recorded.map((r) => r.NAME)).toEqual(['001_items.sql', '002_trigger.sql']);

        expect(await oracle.runMigrations(dir, { table: TABLE })).toEqual([]);
    });

    test('a new file runs alone; two drivers at once apply it once', async () => {
        writeFileSync(join(dir, '003_other.sql'), 'CREATE TABLE iskra_it_m_other (x NUMBER)');
        const second = await startDriver();
        try {
            const results = await Promise.all([
                oracle.runMigrations(dir, { table: TABLE }),
                second.runMigrations(dir, { table: TABLE }),
            ]);
            expect(results.flat()).toEqual(['003_other.sql']);
        } finally {
            await second.stop();
        }
    });

    test('an applied file that changed is refused', async () => {
        writeFileSync(join(dir, '003_other.sql'), 'CREATE TABLE iskra_it_m_other (x NUMBER, y NUMBER)');
        await expect(oracle.runMigrations(dir, { table: TABLE })).rejects.toThrow(
            'Migration 003_other.sql changed after it was applied',
        );
        writeFileSync(join(dir, '003_other.sql'), 'CREATE TABLE iskra_it_m_other (x NUMBER)');
    });

    test('PL/SQL that does not compile fails its file with the compiler errors, unrecorded', async () => {
        const plsql = mkdtempSync(join(tmpdir(), 'iskra-oracle-it-plsql-'));
        try {
            writeFileSync(
                join(plsql, '001_broken.sql'),
                `CREATE OR REPLACE PROCEDURE iskra_it_m_broken IS
BEGIN
    iskra_it_no_such_procedure;
END;
/
`,
            );
            const error = (await oracle
                .runMigrations(plsql, { table: `${TABLE}_P` })
                .catch((e: unknown) => e)) as MigrationError;
            expect(error).toBeInstanceOf(MigrationError);
            expect(error.message).toContain('Migration 001_broken.sql failed at statement 1');
            expect(error.message).toContain('PROCEDURE ISKRA_IT_M_BROKEN');
            expect(error.message).toContain('PLS-00201');
            expect(await oracle.query(`SELECT name FROM ${TABLE}_P`)).toEqual([]);
        } finally {
            rmSync(plsql, { recursive: true, force: true });
            await oracle.execute('DROP PROCEDURE iskra_it_m_broken').catch(() => {});
            for (const table of [`${TABLE}_P`, `${TABLE}_P_LOCK`]) {
                await oracle.execute(`DROP TABLE ${table} PURGE`).catch(() => {});
            }
        }
    });

    test('a failing file is not recorded, and names its statement', async () => {
        writeFileSync(
            join(dir, '004_broken.sql'),
            "INSERT INTO iskra_it_m_items (id, name) VALUES (3, 'tres');\nINSERT INTO iskra_it_m_missing VALUES (1);",
        );
        const error = (await oracle.runMigrations(dir, { table: TABLE }).catch((e: unknown) => e)) as MigrationError;
        expect(error).toBeInstanceOf(MigrationError);
        expect(error.message).toMatch(/^Migration 004_broken\.sql failed at statement 2: ORA-00942/);
        // The file's DML before the failure was rolled back with it.
        expect(await oracle.query(`SELECT id FROM iskra_it_m_items WHERE id = 3`)).toEqual([]);
        expect(await oracle.query(`SELECT name FROM ${TABLE} WHERE name = '004_broken.sql'`)).toEqual([]);
    });
});
