import type { FieldType } from '../constants.ts';

export interface FieldConstraints {
    maxLength?: number;
    minValue?: number;
    maxValue?: number;
    maxOptions?: number;
}

export const FIELD_CONSTRAINTS: Record<FieldType, FieldConstraints> = {
    text: {
        maxLength: 10000,
    },
    textarea: {
        maxLength: 50000,
    },
    email: {
        maxLength: 320,
    },
    number: {
        minValue: -2147483648,
        maxValue: 2147483647,
    },
    date: {},
    select: {
        maxOptions: 500,
    },
    radio: {
        maxOptions: 100,
    },
    checkbox: {
        maxOptions: 100,
    },
};

export function enforceConstraints(fieldType: FieldType, values: {
    maxLength?: number;
    min?: number;
    max?: number;
    options?: unknown[];
}): { maxLength?: number; min?: number; max?: number; optionsTruncated?: boolean } {
    const constraints = FIELD_CONSTRAINTS[fieldType];
    const result: ReturnType<typeof enforceConstraints> = {};

    if (values.maxLength !== undefined && constraints.maxLength !== undefined) {
        result.maxLength = Math.min(values.maxLength, constraints.maxLength);
    }

    if (values.min !== undefined && constraints.minValue !== undefined) {
        result.min = Math.max(values.min, constraints.minValue);
    }

    if (values.max !== undefined && constraints.maxValue !== undefined) {
        result.max = Math.min(values.max, constraints.maxValue);
    }

    if (values.options && constraints.maxOptions !== undefined) {
        result.optionsTruncated = values.options.length > constraints.maxOptions;
    }

    return result;
}
