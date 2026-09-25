import { describe, it, expect } from 'bun:test';
import { pgSchema, mysqlSchema, sqliteSchema, pgUser, mysqlUser, sqliteUser } from '../src/schema';

// The Drizzle auth schema is the contract between auth-kit and any database
// adapter. These tests pin the table set so a renamed/dropped table is caught.
const EXPECTED_TABLES = ['user', 'session', 'account', 'verification'] as const;

describe('auth schema', () => {
    it('exports a postgres schema with all four auth tables', () => {
        expect(Object.keys(pgSchema).sort()).toEqual([...EXPECTED_TABLES].sort());
    });

    it('exports a mysql schema with all four auth tables', () => {
        expect(Object.keys(mysqlSchema).sort()).toEqual([...EXPECTED_TABLES].sort());
    });

    it('exports a sqlite schema with all four auth tables', () => {
        expect(Object.keys(sqliteSchema).sort()).toEqual([...EXPECTED_TABLES].sort());
    });

    it('exposes the individual user tables for each dialect', () => {
        expect(pgUser).toBeDefined();
        expect(mysqlUser).toBeDefined();
        expect(sqliteUser).toBeDefined();
    });

    it('wires the schema dictionaries to the same table objects', () => {
        expect(pgSchema.user).toBe(pgUser);
        expect(mysqlSchema.user).toBe(mysqlUser);
        expect(sqliteSchema.user).toBe(sqliteUser);
    });
});

describe('mysql verification table', () => {
    it('stores values as text: OAuth state JSON exceeds 255 characters', async () => {
        const { getTableConfig } = await import('drizzle-orm/mysql-core');
        const value = getTableConfig(mysqlSchema.verification).columns.find((c) => c.name === 'value')!;
        // varchar(255) made MySQL strict mode reject the OIDC state and every OIDC sign-in failed.
        expect(value.getSQLType()).toBe('text');
    });
});
