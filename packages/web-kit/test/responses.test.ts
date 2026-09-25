import { describe, it, expect } from 'bun:test';
import { successResponse, errorResponse } from '../src/responses';

describe('successResponse', () => {
    it('wraps data and message', () => {
        expect(successResponse({ id: 1 }, 'created')).toEqual({
            success: true,
            data: { id: 1 },
            message: 'created',
        });
    });

    it('omits data when undefined and message when absent', () => {
        expect(successResponse()).toEqual({ success: true });
    });

    it('includes data without a message', () => {
        expect(successResponse([1, 2, 3])).toEqual({ success: true, data: [1, 2, 3] });
    });
});

describe('errorResponse', () => {
    it('derives the message from an Error and stamps a timestamp', () => {
        const res = errorResponse(new Error('boom'), 'E_BOOM', { field: 'x' });
        expect(res.success).toBe(false);
        expect(res.error).toBe('boom');
        expect(res.code).toBe('E_BOOM');
        expect(res.details).toEqual({ field: 'x' });
        expect(typeof res.timestamp).toBe('string');
        expect(Number.isNaN(Date.parse(res.timestamp!))).toBe(false);
    });

    it('accepts a string error and omits optional fields', () => {
        const res = errorResponse('plain failure');
        expect(res.error).toBe('plain failure');
        expect(res.code).toBeUndefined();
        expect(res.details).toBeUndefined();
    });
});
