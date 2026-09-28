import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MigrationError, QueryError } from './errors';
import type { ConnectionHandle, OracleConnectionLike, OracleRawResult } from './types';

export interface MigrationOptions {
    /** Table recording the applied migrations (`<table>_LOCK` serializes runners). Default ISKRA_MIGRATIONS. */
    table?: string;
    /** Seconds to wait for another process running migrations. Default 60. */
    lockTimeout?: number;
}

export interface MigrationDeps {
    connect(): Promise<OracleConnectionLike>;
    run(handle: ConnectionHandle, sql: string, binds: unknown): Promise<OracleRawResult>;
    log(message: string, context: Record<string, unknown>): void;
}

interface MigrationFile {
    name: string;
    sql: string;
    checksum: string;
}

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_$#]{0,120}$/;
const PLSQL_START =
    /^(?:begin|declare|create\s+(?:or\s+replace\s+)?(?:(?:non)?editionable\s+)?(?:procedure|function|package|trigger|type|library))\b/i;
const ORA_NAME_IN_USE = 955;
const ORA_WAIT_TIMEOUT = 30006;

function endOfLine(text: string, from: number): number {
    const nl = text.indexOf('\n', from);
    return nl === -1 ? text.length : nl;
}

/** Whether the line starting at `from` holds only a `/`. */
function isSlashLine(text: string, from: number): boolean {
    return text.slice(from, endOfLine(text, from)).trim() === '/';
}

function skipSpaceAndComments(text: string, from: number): number {
    let i = from;
    while (i < text.length) {
        if (/\s/.test(text[i]!)) i++;
        else if (text.startsWith('--', i)) i = endOfLine(text, i);
        else if (text.startsWith('/*', i)) {
            const close = text.indexOf('*/', i + 2);
            i = close === -1 ? text.length : close + 2;
        } else break;
    }
    return i;
}

function skipQuoted(text: string, from: number, quote: string): number {
    let i = from + 1;
    while (i < text.length) {
        if (text[i] === quote) {
            if (text[i + 1] === quote) i += 2;
            else return i + 1;
        } else i++;
    }
    return i;
}

/**
 * The statements of a migration file, SQL*Plus style: a SQL statement ends
 * with `;` (or a line holding only `/`); a PL/SQL block (BEGIN, DECLARE,
 * CREATE PROCEDURE/FUNCTION/PACKAGE/TRIGGER/TYPE) runs until a line holding
 * only `/`, and keeps its own semicolons.
 */
export function splitStatements(source: string): string[] {
    const text = source.replace(/\r\n?/g, '\n');
    const statements: string[] = [];
    let i = 0;
    while (i < text.length) {
        i = skipSpaceAndComments(text, i);
        if (i >= text.length) break;
        if (isSlashLine(text, i)) {
            i = endOfLine(text, i) + 1;
            continue;
        }
        const start = i;
        if (PLSQL_START.test(text.slice(i, i + 200))) {
            const slash = /^[ \t]*\/[ \t]*$/gm;
            slash.lastIndex = i;
            const match = slash.exec(text);
            const end = match ? match.index : text.length;
            statements.push(text.slice(start, end).trim());
            i = match ? endOfLine(text, end) + 1 : text.length;
            continue;
        }
        let end = text.length;
        let next = text.length;
        let j = i;
        while (j < text.length) {
            const c = text[j];
            if (c === "'" || c === '"') j = skipQuoted(text, j, c);
            else if (text.startsWith('--', j)) j = endOfLine(text, j);
            else if (text.startsWith('/*', j)) {
                const close = text.indexOf('*/', j + 2);
                j = close === -1 ? text.length : close + 2;
            } else if (c === ';') {
                end = j;
                next = j + 1;
                break;
            } else if (c === '\n' && isSlashLine(text, j + 1)) {
                end = j;
                next = endOfLine(text, j + 1) + 1;
                break;
            } else j++;
        }
        const statement = text.slice(start, end).trim();
        if (statement) statements.push(statement);
        i = next;
    }
    return statements;
}

async function readMigrations(dir: string): Promise<MigrationFile[]> {
    let names: string[];
    try {
        names = await readdir(dir);
    } catch (error) {
        throw new MigrationError(`Migrations directory not found: ${dir}`, {
            cause: error instanceof Error ? error : undefined,
            context: { dir },
        });
    }
    const files = names
        .filter((name) => name.toLowerCase().endsWith('.sql'))
        .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    return Promise.all(
        files.map(async (name) => {
            const sql = (await readFile(join(dir, name), 'utf8')).replace(/\r\n?/g, '\n');
            return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
        }),
    );
}

async function createIfMissing(deps: MigrationDeps, handle: ConnectionHandle, ddl: string) {
    try {
        await deps.run(handle, ddl, []);
    } catch (error) {
        if (!(error instanceof QueryError && error.errorNum === ORA_NAME_IN_USE)) throw error;
    }
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

/**
 * Applies the `.sql` files of `dir` not yet recorded in the migrations table,
 * in name order (`001_…`, `002_…`; numbers compare as numbers). Each file's
 * statements and its record commit together, but Oracle commits every DDL
 * statement on its own: a file that fails halfway keeps the DDL before the
 * failure. An applied file that changed since is refused (checksum).
 */
export async function runMigrations(deps: MigrationDeps, dir: string, options: MigrationOptions = {}) {
    const table = (options.table ?? 'ISKRA_MIGRATIONS').toUpperCase();
    if (!IDENTIFIER.test(table)) throw new MigrationError(`Invalid migrations table name: ${table}`);
    const lockTimeout = options.lockTimeout ?? 60;
    if (!Number.isInteger(lockTimeout) || lockTimeout < 0 || lockTimeout > 100_000) {
        throw new MigrationError('lockTimeout must be a whole number of seconds between 0 and 100000');
    }
    const lockTable = `${table}_LOCK`;
    const files = await readMigrations(dir);

    // The lock is held on a connection of its own for the whole run: the
    // DDL of a migration commits, which would release a lock taken on the
    // connection that runs it.
    const lockConnection = await deps.connect();
    const lock: ConnectionHandle = { connection: lockConnection, inTransaction: true, release: async () => {} };
    let work: ConnectionHandle | undefined;
    try {
        await createIfMissing(
            deps,
            lock,
            `CREATE TABLE ${table} (name VARCHAR2(255) PRIMARY KEY, checksum VARCHAR2(64) NOT NULL, ` +
                `applied_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL)`,
        );
        await createIfMissing(deps, lock, `CREATE TABLE ${lockTable} (id NUMBER PRIMARY KEY)`);
        try {
            await deps.run(lock, `LOCK TABLE ${lockTable} IN EXCLUSIVE MODE WAIT ${lockTimeout}`, []);
        } catch (error) {
            const busy = error instanceof QueryError && error.errorNum === ORA_WAIT_TIMEOUT;
            throw new MigrationError(
                busy
                    ? `Another process is running migrations (waited ${lockTimeout}s for ${lockTable})`
                    : 'Failed to lock the migrations table',
                { cause: asError(error), context: { table: lockTable } },
            );
        }

        work = { connection: await deps.connect(), inTransaction: true, release: async () => {} };
        const recorded = await deps.run(work, `SELECT name, checksum FROM ${table}`, []);
        const applied = new Map(
            ((recorded.rows ?? []) as { NAME: string; CHECKSUM: string }[]).map((r) => [r.NAME, r.CHECKSUM]),
        );

        const done: string[] = [];
        for (const file of files) {
            const checksum = applied.get(file.name);
            if (checksum !== undefined) {
                if (checksum !== file.checksum) {
                    throw new MigrationError(`Migration ${file.name} changed after it was applied`, {
                        context: { migration: file.name },
                    });
                }
                continue;
            }
            const statements = splitStatements(file.sql);
            for (const [index, statement] of statements.entries()) {
                try {
                    await deps.run(work, statement, []);
                } catch (error) {
                    await work.connection.rollback().catch(() => {});
                    throw new MigrationError(
                        `Migration ${file.name} failed at statement ${index + 1}: ${asError(error).message}`,
                        { cause: asError(error), context: { migration: file.name, statement: index + 1 } },
                    );
                }
            }
            await deps.run(work, `INSERT INTO ${table} (name, checksum) VALUES (:name, :checksum)`, {
                name: file.name,
                checksum: file.checksum,
            });
            await work.connection.commit();
            done.push(file.name);
            deps.log('Migration applied', { migration: file.name, statements: statements.length });
        }
        return done;
    } catch (error) {
        if (error instanceof MigrationError) throw error;
        throw new MigrationError(`Failed to run migrations: ${asError(error).message}`, {
            cause: asError(error),
            context: { dir },
        });
    } finally {
        // Ending the lock connection's transaction releases the table lock.
        await lockConnection.rollback().catch(() => {});
        await lockConnection.close().catch(() => {});
        await work?.connection.close().catch(() => {});
    }
}
