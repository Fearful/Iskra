import { describe, it, expect } from 'bun:test';
import { getErrorMessage, enforceConstraints, FIELD_CONSTRAINTS } from '../src/validation/index.ts';

describe('getErrorMessage', () => {
    it('returns the custom message when one is provided', () => {
        expect(getErrorMessage('text', 'required', 'My custom')).toBe('My custom');
    });

    it('falls back to the default message for the field type and rule', () => {
        expect(getErrorMessage('email', 'format')).toBe('Please enter a valid email address');
        expect(getErrorMessage('number', 'type')).toBe('Must be a number');
    });

    it('returns a generic fallback for a rule the field type does not define', () => {
        expect(getErrorMessage('select', 'maxLength' as any)).toBe('Invalid value');
    });

    it('ignores empty or null custom messages', () => {
        expect(getErrorMessage('text', 'required', '')).toBe('This field is required');
        expect(getErrorMessage('text', 'required', null)).toBe('This field is required');
    });
});

describe('enforceConstraints', () => {
    it("caps maxLength to the field type's limit", () => {
        expect(enforceConstraints('text', { maxLength: 999999 }).maxLength).toBe(FIELD_CONSTRAINTS.text.maxLength);
        expect(enforceConstraints('email', { maxLength: 10 }).maxLength).toBe(10);
    });

    it('clamps number min/max to the int32 range', () => {
        const r = enforceConstraints('number', { min: -99999999999, max: 99999999999 });
        expect(r.min).toBe(-2147483648);
        expect(r.max).toBe(2147483647);
    });

    it('flags when options exceed the allowed count', () => {
        expect(enforceConstraints('radio', { options: new Array(101) }).optionsTruncated).toBe(true);
        expect(enforceConstraints('radio', { options: new Array(50) }).optionsTruncated).toBe(false);
    });

    it('returns nothing for a field type without matching constraints', () => {
        expect(enforceConstraints('date', { maxLength: 5 })).toEqual({});
    });
});
