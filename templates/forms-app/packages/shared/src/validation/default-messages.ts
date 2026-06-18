import type { FieldType } from '../constants.ts';
import type { FieldErrorMessages } from '../types/form.ts';

export const DEFAULT_ERROR_MESSAGES: Record<FieldType, FieldErrorMessages> = {
    text: {
        required: 'This field is required',
        type: 'Must be text',
        maxLength: 'Maximum {max} characters allowed',
        minLength: 'Minimum {min} characters required',
    },
    textarea: {
        required: 'This field is required',
        type: 'Must be text',
        maxLength: 'Maximum {max} characters allowed',
        minLength: 'Minimum {min} characters required',
    },
    email: {
        required: 'Email address is required',
        type: 'Must be text',
        format: 'Please enter a valid email address',
        maxLength: 'Email is too long',
    },
    number: {
        required: 'This field is required',
        type: 'Must be a number',
        minimum: 'Value must be at least {min}',
        maximum: 'Value must be at most {max}',
    },
    date: {
        required: 'Please select a date',
        type: 'Must be a valid date',
        format: 'Invalid date format',
    },
    select: {
        required: 'Please select an option',
        type: 'Invalid selection',
    },
    radio: {
        required: 'Please select an option',
        type: 'Invalid selection',
    },
    checkbox: {
        required: 'This field is required',
        type: 'Invalid selection',
    },
};

export function getErrorMessage(
    fieldType: FieldType,
    rule: keyof FieldErrorMessages,
    customMessage?: string | null,
): string {
    if (customMessage) return customMessage;
    return DEFAULT_ERROR_MESSAGES[fieldType]?.[rule] ?? 'Invalid value';
}
