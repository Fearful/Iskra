import { describe, expect, test } from 'bun:test';
import { DeadlineError, NoRowsError, QueryError, QueryInputError, toQueryError } from '../src/errors';
import { oraError } from './fakes';

const njs = (num: number) => {
    const code = `NJS-${String(num).padStart(3, '0')}`;
    return Object.assign(new Error(`${code}: …`), { code });
};

describe('error codes, for an HTTP answer', () => {
    test('a timeout is TIMEOUT, a full pool SERVICE_UNAVAILABLE, a duplicate key CONFLICT', () => {
        expect(toQueryError(njs(123)).code).toBe('TIMEOUT');
        expect(new DeadlineError(10).code).toBe('TIMEOUT');
        expect(toQueryError(njs(40)).code).toBe('SERVICE_UNAVAILABLE');
        expect(toQueryError(oraError(1, 'unique constraint violated')).code).toBe('CONFLICT');
        expect(toQueryError(oraError(942, 'table or view does not exist')).code).toBe('QUERY_ERROR');
        expect(new QueryError('Oracle driver not started').code).toBe('QUERY_ERROR');
    });

    test("a request's bad cursor or sort field is a VALIDATION_ERROR whose message is for the client", () => {
        const error = new QueryInputError('Cannot sort by "password"');
        expect(error.code).toBe('VALIDATION_ERROR');
        expect(error.expose).toBe(true);
        expect(toQueryError(njs(123)).expose).toBe(false);
    });
});

describe("a stored procedure's RAISE_APPLICATION_ERROR", () => {
    test('is a CONFLICT whose message, without its ORA prefix and stack, is for the client', () => {
        const raised = Object.assign(
            new Error('ORA-20001: El legajo ya tiene un alta vigente\nORA-06512: at "CORE.ALTA_EMPLEADO", line 12'),
            { errorNum: 20001, code: 'ORA-20001' },
        );
        const error = toQueryError(raised);
        expect(error.code).toBe('CONFLICT');
        expect(error.message).toBe('El legajo ya tiene un alta vigente');
        expect(error.applicationError).toEqual({ number: 20001, message: 'El legajo ya tiene un alta vigente' });
        expect(error.expose).toBe(true);
        expect(error.cause).toBe(raised);
    });

    test('other errors are not application errors', () => {
        expect(toQueryError(oraError(1, 'unique constraint violated')).applicationError).toBeUndefined();
    });
});

test('NoRowsError is a NOT_FOUND', () => {
    expect(new NoRowsError().code).toBe('NOT_FOUND');
    expect(new NoRowsError()).toBeInstanceOf(QueryError);
});
