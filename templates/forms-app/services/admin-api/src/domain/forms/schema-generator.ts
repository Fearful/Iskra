import type { FieldType } from '@forms-app/shared';
import { getErrorMessage } from '@forms-app/shared/validation';
import type { FieldErrorMessages } from '@forms-app/shared';

interface FieldDefinition {
    fieldType: FieldType;
    name: string;
    label: string;
    required: boolean;
    maxLength?: number | null;
    min?: number | null;
    max?: number | null;
    options?: { label: string; value: string }[] | null;
    errorMessage?: string | null;
}

interface JsonSchemaProperty {
    type: string;
    format?: string;
    minLength?: number;
    maxLength?: number;
    minimum?: number;
    maximum?: number;
    enum?: string[];
    const?: boolean;
    items?: { type: 'string'; enum: string[] };
    minItems?: number;
    uniqueItems?: boolean;
    errorMessage: Record<string, string>;
}

interface JsonSchema {
    type: 'object';
    properties: Record<string, JsonSchemaProperty>;
    required: string[];
    /** Only the form's fields are accepted. */
    additionalProperties: false;
    /**
     * Required-field messages by field name. They go on the object: AJV
     * reports a missing property there, so a property's own
     * `errorMessage.required` was never used.
     */
    errorMessage?: { required: Record<string, string> };
}

/** Longest accepted answer when the field sets no maxLength. */
const DEFAULT_MAX_LENGTH = { text: 1000, textarea: 10000, email: 254 } as const;

function buildErrorMessages(field: FieldDefinition): Record<string, string> {
    const custom = field.errorMessage;
    const ft = field.fieldType;
    const msgs: Record<string, string> = {};

    msgs.type = getErrorMessage(ft, 'type', custom);

    if (field.required) {
        msgs.required = getErrorMessage(ft, 'required', custom);
    }

    if (field.maxLength) {
        msgs.maxLength = getErrorMessage(ft, 'maxLength', custom)
            .replace('{max}', String(field.maxLength));
    }

    if (field.min !== undefined && field.min !== null) {
        msgs.minimum = getErrorMessage(ft, 'minimum', custom)
            .replace('{min}', String(field.min));
    }

    if (field.max !== undefined && field.max !== null) {
        msgs.maximum = getErrorMessage(ft, 'maximum', custom)
            .replace('{max}', String(field.max));
    }

    if (ft === 'email') {
        msgs.format = getErrorMessage(ft, 'format', custom);
    }

    return msgs;
}

export function generateJsonSchema(fields: FieldDefinition[]): JsonSchema {
    const properties: Record<string, JsonSchemaProperty> = {};
    const required: string[] = [];
    const requiredMessages: Record<string, string> = {};

    for (const field of fields) {
        const errorMessage = buildErrorMessages(field);
        /** A required text answer must not be empty (`""` passed `required`). */
        const nonEmpty = (prop: JsonSchemaProperty) => {
            if (!field.required) return;
            prop.minLength = 1;
            errorMessage.minLength = errorMessage.required!;
        };

        switch (field.fieldType) {
            case 'text':
            case 'textarea': {
                const prop: JsonSchemaProperty = {
                    type: 'string',
                    errorMessage,
                };
                prop.maxLength = field.maxLength || DEFAULT_MAX_LENGTH[field.fieldType];
                nonEmpty(prop);
                properties[field.name] = prop;
                break;
            }

            case 'email': {
                const prop: JsonSchemaProperty = {
                    type: 'string',
                    format: 'email',
                    errorMessage,
                };
                prop.maxLength = field.maxLength || DEFAULT_MAX_LENGTH.email;
                properties[field.name] = prop;
                break;
            }

            case 'number': {
                const prop: JsonSchemaProperty = {
                    type: 'number',
                    errorMessage,
                };
                if (field.min !== undefined && field.min !== null) prop.minimum = field.min;
                if (field.max !== undefined && field.max !== null) prop.maximum = field.max;
                properties[field.name] = prop;
                break;
            }

            case 'date': {
                properties[field.name] = {
                    type: 'string',
                    format: 'date',
                    errorMessage,
                };
                break;
            }

            case 'select':
            case 'radio': {
                const enumValues = field.options?.map((o) => o.value) ?? [];
                properties[field.name] = {
                    type: 'string',
                    enum: enumValues,
                    errorMessage,
                };
                break;
            }

            case 'checkbox': {
                if (field.options && field.options.length > 0) {
                    // Several options: the values checked (it was typed as a
                    // single string, so checking two failed validation).
                    const prop: JsonSchemaProperty = {
                        type: 'array',
                        items: { type: 'string', enum: field.options.map((o) => o.value) },
                        uniqueItems: true,
                        errorMessage,
                    };
                    if (field.required) {
                        prop.minItems = 1;
                        errorMessage.minItems = errorMessage.required!;
                    }
                    properties[field.name] = prop;
                } else {
                    // Single boolean checkbox; required means checked (false
                    // used to pass, e.g. for "I accept the terms").
                    const prop: JsonSchemaProperty = {
                        type: 'boolean',
                        errorMessage,
                    };
                    if (field.required) {
                        prop.const = true;
                        errorMessage.const = errorMessage.required!;
                    }
                    properties[field.name] = prop;
                }
                break;
            }
        }

        if (field.required) {
            required.push(field.name);
            requiredMessages[field.name] = errorMessage.required!;
        }
    }

    return {
        type: 'object',
        properties,
        required,
        additionalProperties: false,
        ...(required.length > 0 ? { errorMessage: { required: requiredMessages } } : {}),
    };
}
