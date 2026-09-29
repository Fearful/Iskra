import { describe, expect, test } from 'bun:test';
import { DeadlineError, QueryError, QueryInputError, toQueryError } from '../src/errors';
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
        expect((toQueryError(njs(123)) as { expose?: boolean }).expose).toBeUndefined();
    });
});
