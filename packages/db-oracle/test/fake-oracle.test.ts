import { describe, expect, test } from 'bun:test';
import { fakeOracle } from '@iskra-bun/db-oracle/testing';
import { col, rowSpec, type OracleDatabase } from '../src/index';
import { NoRowsError, toQueryError } from '../src/errors';
import { oraError } from './fakes';

const Usuario = rowSpec({ id: col.int(), nombre: col.string(), activo: col.boolean() });

/** A repository typed against OracleDatabase, as an app writes it. */
class UsuariosRepo {
    constructor(private readonly db: OracleDatabase) {}
    buscar(id: number) {
        return this.db.one('SELECT id, nombre, activo FROM usuarios WHERE id = :id', { id }, { rows: Usuario });
    }
    listar(filters: { activo?: boolean }, offset: number, limit: number) {
        return this.db.list({
            query: (f, orders) => ({
                sql: `SELECT id, nombre, activo FROM usuarios${f.activo === undefined ? '' : ' WHERE activo = :activo'}${orders ? ` ORDER BY ${orders}` : ''}`,
                params: f.activo === undefined ? {} : { activo: f.activo ? 'S' : 'N' },
            }),
            filters,
            orders: 'id',
            totalFilters: {},
            offset,
            limit,
            rows: Usuario,
        });
    }
    alta(nombre: string) {
        return this.db.transaction((tx) =>
            tx.execute('INSERT INTO usuarios (nombre) VALUES (:nombre) RETURNING id INTO :id', {
                nombre,
                id: { dir: 'returning', type: 'number' },
            }),
        );
    }
}

describe('fakeOracle()', () => {
    test('answers by SQL matchers and records the binds, as the repository wrote them', async () => {
        const oracle = fakeOracle();
        oracle.on(/FROM usuarios WHERE id = :id/).reply([{ ID: 1, NOMBRE: 'Ana', ACTIVO: 'S' }]);
        expect(await new UsuariosRepo(oracle).buscar(1)).toEqual({ id: 1, nombre: 'Ana', activo: true });
        expect(oracle.calls).toEqual([
            { method: 'one', sql: 'SELECT id, nombre, activo FROM usuarios WHERE id = :id', binds: { id: 1 } },
        ]);
        oracle.expectAllMatched();
    });

    test('one() throws NoRowsError when the rule answers no rows; a failure is thrown as given', async () => {
        const oracle = fakeOracle();
        oracle.on('from usuarios where id').reply([]);
        await expect(new UsuariosRepo(oracle).buscar(9)).rejects.toBeInstanceOf(NoRowsError);
        oracle.on('from usuarios where id').fail(toQueryError(oraError(942, 'table or view does not exist')));
        await expect(new UsuariosRepo(oracle).buscar(9)).rejects.toThrow('ORA-00942');
    });

    test('list() counts and pages the rows the query answers', async () => {
        const oracle = fakeOracle();
        const all = Array.from({ length: 7 }, (_, i) => ({
            ID: i + 1,
            NOMBRE: `U${i + 1}`,
            ACTIVO: i < 5 ? 'S' : 'N',
        }));
        oracle
            .on((sql) => sql.includes('FROM usuarios'))
            .reply((sql, binds) => {
                const activo = (binds as { activo?: string }).activo;
                return sql.includes('WHERE activo') ? all.filter((u) => u.ACTIVO === activo) : all;
            });
        const page = await new UsuariosRepo(oracle).listar({ activo: true }, 2, 2);
        expect(page).toEqual({
            rows: [
                { id: 3, nombre: 'U3', activo: true },
                { id: 4, nombre: 'U4', activo: true },
            ],
            total: 7,
            filtered: 5,
            offset: 2,
            limit: 2,
            pages: 3,
        });
    });

    test('a transaction commits or rolls back, and a statement nobody answers throws', async () => {
        const oracle = fakeOracle();
        oracle
            .on('INSERT INTO usuarios')
            .reply({ rowsAffected: 1, outBinds: { id: [42] } })
            .once();
        expect((await new UsuariosRepo(oracle).alta('Ana')).outBinds).toEqual({ id: [42] });
        expect(oracle.commits).toBe(1);

        await expect(new UsuariosRepo(oracle).alta('Leo')).rejects.toThrow('no rule answers this statement');
        expect(oracle.rollbacks).toBe(1);

        const unused = fakeOracle();
        unused.on('DELETE FROM usuarios');
        expect(() => unused.expectAllMatched()).toThrow('DELETE FROM usuarios');
    });
});
