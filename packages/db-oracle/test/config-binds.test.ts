import { describe, expect, test } from 'bun:test';
import { ConfigError } from '@iskra-bun/core';
import oracledb from 'oracledb';
import { fetchTypeHandler, readOutBinds, toOracleBinds } from '../src/binds';
import { resolveConfig } from '../src/config';

describe('resolveConfig', () => {
    test('undefined without app config or ORA_CONN', () => {
        expect(resolveConfig(undefined, {})).toBeUndefined();
    });

    test('reads ORA_* when there is no app config', () => {
        const config = resolveConfig(undefined, { ORA_CONN: 'h:1521/S', ORA_USER: 'u', ORA_PASSWORD: 'p' });
        expect(config).toMatchObject({ connectString: 'h:1521/S', user: 'u', password: 'p' });
    });

    test('app config wins over ORA_*, with defaults filled in', () => {
        const config = resolveConfig({ connectString: 'app:1521/S' }, { ORA_CONN: 'env:1521/S' })!;
        expect(config.connectString).toBe('app:1521/S');
        expect(config.pool).toEqual({ min: 0, max: 4, increment: 1, queueTimeout: 60_000, drainTime: 5 });
        expect([...config.fetchAsString]).toEqual([]);
        expect(config.camelCase).toBe(false);
    });

    test.each([
        [{}, 'connectString is required'],
        [{ connectString: 1 }, 'connectString must be a string'],
        [{ connectString: 'x', pool: { max: 0 } }, 'pool.max must be at least 1'],
        [{ connectString: 'x', pool: { min: 5, max: 2 } }, 'pool.min cannot be larger than pool.max'],
        [{ connectString: 'x', pool: { queueTimeout: -1 } }, 'pool.queueTimeout must be an integer >= 0'],
        [{ connectString: 'x', fetchAsString: ['clob'] }, "fetchAsString must be a list of 'number', 'date'"],
        [{ connectString: 'x', camelCase: 'yes' }, 'camelCase must be a boolean'],
        ['x', 'expected an object'],
    ])('rejects %j', (section, message) => {
        expect(() => resolveConfig(section, {})).toThrow(ConfigError);
        expect(() => resolveConfig(section, {})).toThrow(message);
    });
});

describe('toOracleBinds', () => {
    test('leaves plain values alone, by name and by position', () => {
        const date = new Date();
        const buffer = Buffer.from('x');
        expect(toOracleBinds(oracledb, { a: 1, b: 'x', c: null, d: date, e: buffer })).toEqual({
            a: 1,
            b: 'x',
            c: null,
            d: date,
            e: buffer,
        });
        expect(toOracleBinds(oracledb, [1, 'x'])).toEqual([1, 'x']);
        expect(toOracleBinds(oracledb, undefined)).toEqual([]);
    });

    test('translates type names and directions', () => {
        expect(
            toOracleBinds(oracledb, {
                body: { type: 'clob', val: 'text' },
                id: { dir: 'returning', type: 'number' },
                msg: { dir: 'out', type: 'string' },
                raw: { dir: 'out', type: 'raw', maxSize: 16 },
                counter: { dir: 'inout', type: 'number', val: 1 },
                when: { dir: 'out', type: 'timestamp' },
            }),
        ).toEqual({
            body: { dir: oracledb.BIND_IN, type: oracledb.DB_TYPE_CLOB, val: 'text' },
            id: { dir: oracledb.BIND_OUT, type: oracledb.DB_TYPE_NUMBER },
            msg: { dir: oracledb.BIND_OUT, type: oracledb.DB_TYPE_VARCHAR, maxSize: 4000 },
            raw: { dir: oracledb.BIND_OUT, type: oracledb.DB_TYPE_RAW, maxSize: 16 },
            counter: { dir: oracledb.BIND_INOUT, type: oracledb.DB_TYPE_NUMBER, val: 1 },
            when: { dir: oracledb.BIND_OUT, type: oracledb.DB_TYPE_TIMESTAMP },
        });
    });

    test('rejects an unknown type or direction', () => {
        expect(() => toOracleBinds(oracledb, { x: { dir: 'out', type: 'varchar' as never } })).toThrow(
            'Bind "x": unknown Oracle type "varchar"',
        );
        expect(() => toOracleBinds(oracledb, [{ dir: 'sideways' as never, type: 'number' }])).toThrow(
            'Bind "1": unknown direction "sideways"',
        );
    });
});

describe('readOutBinds', () => {
    test('reads and frees LOBs, in arrays too', async () => {
        const destroyed: string[] = [];
        const lob = (data: string) => ({ getData: async () => data, destroy: () => void destroyed.push(data) });
        expect(await readOutBinds({ a: lob('x'), b: [lob('y'), null], c: 3 })).toEqual({
            a: 'x',
            b: ['y', null],
            c: 3,
        });
        expect(destroyed).toEqual(['x', 'y']);
        expect(await readOutBinds([lob('z')])).toEqual(['z']);
        expect(await readOutBinds(undefined)).toEqual({});
    });
});

describe('fetchTypeHandler', () => {
    test('CLOB and NCLOB as strings, BLOB as Buffer, and the configured extras', () => {
        const plain = fetchTypeHandler(oracledb, new Set());
        expect(plain({ dbType: oracledb.DB_TYPE_NCLOB })).toEqual({ type: oracledb.STRING });
        expect(plain({ dbType: oracledb.DB_TYPE_BLOB })).toEqual({ type: oracledb.BUFFER });
        expect(plain({ dbType: oracledb.DB_TYPE_DATE })).toBeUndefined();

        const extras = fetchTypeHandler(oracledb, new Set(['number', 'date'] as const));
        expect(extras({ dbType: oracledb.DB_TYPE_NUMBER })).toEqual({ type: oracledb.STRING });
        expect(extras({ dbType: oracledb.DB_TYPE_TIMESTAMP_TZ })).toEqual({ type: oracledb.STRING });
        expect(extras({ dbType: oracledb.DB_TYPE_VARCHAR })).toBeUndefined();
    });
});
