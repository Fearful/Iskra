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
    errorMessage: Record<string, string>;
}

interface JsonSchema {
    type: 'object';
    properties: Record<string, JsonSchemaProperty>;
    required: string[];
}

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

    for (const field of fields) {
        const errorMessage = buildErrorMessages(field);

        switch (field.fieldType) {
            case 'text':
            case 'textarea': {
                const prop: JsonSchemaProperty = {
                    type: 'string',
                    errorMessage,
                };
                if (field.maxLength) prop.maxLength = field.maxLength;
                properties[field.name] = prop;
                break;
            }

            case 'email': {
                const prop: JsonSchemaProperty = {
                    type: 'string',
                    format: 'email',
                    errorMessage,
                };
                if (field.maxLength) prop.maxLength = field.maxLength;
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
                    // Multiple checkbox → array of strings
                    properties[field.name] = {
                        type: 'string',
                        errorMessage,
                    } as any;
                    // For array type, we'd need a more complex schema
                    // For simplicity, treat as comma-separated or use array
                } else {
                    // Single boolean checkbox
                    properties[field.name] = {
                        type: 'boolean',
                        errorMessage,
                    };
                }
                break;
            }
        }

        if (field.required) {
            required.push(field.name);
        }
    }

    return {
        type: 'object',
        properties,
        required,
    };
}
