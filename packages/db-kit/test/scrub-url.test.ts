import { describe, test, expect, mock, spyOn } from 'bun:test';
import { scrubUrl } from '../src/driver';
import { scrubCredentials } from '../src/migrations';
import { App } from '@iskra-bun/core';
import { DbDriver } from '../src/driver';
import { ConnectionError } from '../src/errors';

// ── Bug A: scrubUrl helper ────────────────────────────────────────────────────

describe('scrubUrl', () => {
    test('redacts username and password from a postgres URL', () => {
        const result = scrubUrl('postgres://myuser:s3cr3t@db.example.com:5432/mydb');
        expect(result).toBe('postgres://***:***@db.example.com:5432/mydb');
    });

    test('redacts username and password from a mysql URL', () => {
        const result = scrubUrl('mysql://admin:hunter2@mysql.host:3306/appdb');
        expect(result).toBe('mysql://***:***@mysql.host:3306/appdb');
    });

    test('leaves URLs with no credentials unchanged', () => {
        const result = scrubUrl('postgres://localhost:5432/mydb');
        expect(result).toBe('postgres://localhost:5432/mydb');
    });

    test('redacts only username when no password is present', () => {
        const result = scrubUrl('postgres://myuser@localhost/mydb');
        expect(result).toBe('postgres://***@localhost/mydb');
    });

    test('returns undefined for an unparseable string (e.g. :memory:)', () => {
        expect(scrubUrl(':memory:')).toBeUndefined();
    });

    test('returns undefined for a bare file path', () => {
        expect(scrubUrl('/tmp/foo.sqlite')).toBeUndefined();
    });
});

// ── Bug A: ConnectionError context must not expose plaintext credentials ──────

describe('ConnectionError context does not leak credentials', () => {
    test('scrubbed URL in context contains no plaintext password', async () => {
        // Force a connection failure by using an invalid SQLite path so we can
        // inspect the ConnectionError that driver.ts throws without needing a
        // live Postgres/MySQL server.  The URL here contains fake credentials
        // so we can assert they are redacted.
        const credentialUrl = 'postgres://leakuser:leakpass@nonexistent.invalid:5432/db';

        // We can't connect to a real postgres with this URL, but the postgres.js
        // client only fails at query time, not construction — so we instead
        // test directly by constructing the same error that driver.ts builds:
        const safeUrl = scrubUrl(credentialUrl);
        const err = new ConnectionError('Failed to connect to DB', {
            cause: new Error('connection refused'),
            context: {
                driver: 'postgres',
                ...(safeUrl !== undefined ? { url: safeUrl } : {}),
            },
        });

        const contextUrl = (err.context as Record<string, unknown>)['url'] as string | undefined;
        expect(contextUrl).toBeDefined();
        expect(contextUrl).not.toContain('leakuser');
        expect(contextUrl).not.toContain('leakpass');
        expect(contextUrl).toContain('***');
    });

    test('ConnectionError context omits url entirely when URL cannot be parsed', () => {
        const safeUrl = scrubUrl(':memory:'); // returns undefined
        const err = new ConnectionError('Failed to connect to DB', {
            cause: new Error('open failed'),
            context: {
                driver: 'sqlite',
                ...(safeUrl !== undefined ? { url: safeUrl } : {}),
            },
        });

        expect((err.context as Record<string, unknown>)['url']).toBeUndefined();
    });
});

// ── Bug B: MySQL path uses createPool, not createConnection ──────────────────

describe('DbDriver mysql branch uses createPool', () => {
    test('client is a Pool (has getConnection) not a single Connection after mysql start', async () => {
        // mysql.createPool() returns an object with getConnection/pool property.
        // mysql.createConnection() returns a Connection without getConnection.
        // We mock at the default-export level so driver.ts sees our stubs.
        const mysql2Module = await import('mysql2/promise');
        const mysql2Default = mysql2Module.default;

        // Track which factory was called
        let poolCalled = false;
        let connCalled = false;

        const fakePool = {
            // Pool interface: has getConnection method
            getConnection: async () => ({}),
            query: async () => [[{ '1': 1 }], []],
            execute: async () => [[{ '1': 1 }], []],
            end: async () => {},
        };

        const origCreatePool = mysql2Default.createPool.bind(mysql2Default);
        const origCreateConnection = mysql2Default.createConnection.bind(mysql2Default);

        const poolSpy = spyOn(mysql2Default, 'createPool').mockImplementation((...args: any[]) => {
            poolCalled = true;
            return fakePool as any;
        });

        const connSpy = spyOn(mysql2Default, 'createConnection').mockImplementation((...args: any[]) => {
            connCalled = true;
            throw new Error('createConnection must not be called for mysql branch');
        });

        try {
            const app = new App({
                name: 'MysqlPoolTest2',
                db: { driver: 'mysql', url: 'mysql://user:pass@localhost:3306/testdb' },
            });
            const driver = new DbDriver();
            app.register(driver);
            await app.start();

            // The driver's internal client should have `getConnection` (pool interface)
            const client = (driver as any).client;
            expect(poolCalled).toBe(true);
            expect(connCalled).toBe(false);
            expect(typeof client.getConnection).toBe('function');

            await app.stop();
        } finally {
            poolSpy.mockRestore();
            connSpy.mockRestore();
        }
    });
});

describe('secrets outside the userinfo', () => {
    test('scrubUrl redacts secret query parameters such as libsql authToken', () => {
        expect(scrubUrl('libsql://mydb.turso.io?authToken=eyJSECRET')).toBe('libsql://mydb.turso.io?authToken=***');
        expect(scrubUrl('postgres://app@db:5432/x?password=S&sslmode=require')).toBe(
            'postgres://***@db:5432/x?password=***&sslmode=require',
        );
    });

    test('scrubCredentials redacts passwords with raw @ or / and secret parameters', () => {
        expect(scrubCredentials('failed postgres://user:p@ss@db:5432/x')).toBe('failed postgres://***:***@db:5432/x');
        expect(scrubCredentials('failed postgresql://user:pa/ss@db/x')).toBe('failed postgresql://***:***@db/x');
        expect(scrubCredentials('error: libsql://db.turso.io?authToken=SECRET&x=1 down')).toBe(
            'error: libsql://db.turso.io?authToken=***&x=1 down',
        );
    });

    test('the connection error context does not carry the libsql authToken', async () => {
        const app = new App({
            name: 'ScrubTest',
            logger: { level: 'silent' },
            db: { driver: 'libsql', url: 'http://127.0.0.1:9/?authToken=TOPSECRET' },
        } as any);
        app.register(new DbDriver());
        const error = await app.start().then(() => undefined, (e: unknown) => e);
        expect(JSON.stringify(error)).not.toContain('TOPSECRET');
        expect(String((error as any)?.context?.url ?? (error as any)?.cause?.context?.url)).toContain('authToken=***');
    });
});
