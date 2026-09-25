import { describe, test, expect } from 'bun:test';
import { IskraError } from '@iskra-bun/core';
import { ConnectionError, QueryError, MigrationError } from '../src/errors';

// Unit coverage for db-kit's three error subclasses: correct code, name,
// IskraError inheritance, and cause/context propagation.

describe('db-kit errors', () => {
    test('ConnectionError carries the CONNECTION_ERROR code', () => {
        const err = new ConnectionError('cannot reach db');
        expect(err).toBeInstanceOf(IskraError);
        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBe('CONNECTION_ERROR');
        expect(err.name).toBe('ConnectionError');
        expect(err.context).toEqual({});
    });

    test('QueryError carries the QUERY_ERROR code', () => {
        const err = new QueryError('bad sql');
        expect(err).toBeInstanceOf(IskraError);
        expect(err.code).toBe('QUERY_ERROR');
        expect(err.name).toBe('QueryError');
    });

    test('MigrationError carries the MIGRATION_ERROR code', () => {
        const err = new MigrationError('migration failed');
        expect(err).toBeInstanceOf(IskraError);
        expect(err.code).toBe('MIGRATION_ERROR');
        expect(err.name).toBe('MigrationError');
    });

    test('propagates cause and context', () => {
        const cause = new Error('ETIMEDOUT');
        const err = new ConnectionError('connect failed', {
            cause,
            context: { host: 'db.local', port: 5432 },
        });
        expect(err.cause).toBe(cause);
        expect(err.context).toEqual({ host: 'db.local', port: 5432 });
    });

    test('the three error types are distinguishable by code', () => {
        const codes = [new ConnectionError('a').code, new QueryError('b').code, new MigrationError('c').code];
        expect(new Set(codes).size).toBe(3);
    });
});
