import type { FieldType, FormStatus } from '../constants.ts';

export interface FieldOption {
    label: string;
    value: string;
}

export interface FieldErrorMessages {
    required?: string;
    type?: string;
    maxLength?: string;
    minLength?: string;
    minimum?: string;
    maximum?: string;
    format?: string;
    pattern?: string;
}

export interface FormField {
    id: string;
    formId: string;
    fieldType: FieldType;
    label: string;
    name: string;
    position: number;
    required: boolean;
    options: FieldOption[] | null;
    maxLength: number | null;
    min: number | null;
    max: number | null;
    placeholder: string | null;
    helpText: string | null;
    errorMessage: string | null;
}

/** One answer field in a form's validation schema (AJV + ajv-errors). */
export interface JsonSchemaProperty {
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

/** The JSON Schema generated from a form's fields, used to validate answers. */
export interface JsonSchema {
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

export interface Form {
    id: string;
    spaceId: string;
    title: string;
    description: string | null;
    slug: string;
    /** The field definitions the form was created or last updated with. */
    schema: CreateFieldInput[] | null;
    validationSchema: JsonSchema | null;
    startsAt: Date | null;
    endsAt: Date | null;
    status: FormStatus;
    createdAt: Date;
    updatedAt: Date;
}

export interface FormWithFields extends Form {
    fields: FormField[];
}

export interface CreateFormInput {
    title: string;
    slug: string;
    description?: string;
    startsAt?: string;
    endsAt?: string;
    fields: CreateFieldInput[];
}

export interface CreateFieldInput {
    fieldType: FieldType;
    label: string;
    name: string;
    position: number;
    required?: boolean;
    options?: FieldOption[];
    maxLength?: number;
    min?: number;
    max?: number;
    placeholder?: string;
    helpText?: string;
    errorMessage?: string;
}

export interface UpdateFormInput {
    title?: string;
    slug?: string;
    description?: string;
    startsAt?: string;
    endsAt?: string;
    fields?: CreateFieldInput[];
}

export interface Answer {
    id: string;
    formId: string;
    data: Record<string, unknown>;
    submittedAt: Date;
    ipHash: string | null;
    recaptchaScore: number | null;
}

export interface SubmitAnswerInput {
    data: Record<string, unknown>;
    recaptchaToken: string;
}

export interface AnswerJob {
    formId: string;
    data: Record<string, unknown>;
    ipHash: string;
    recaptchaScore: number;
}

export interface FormMeta {
    formId: string;
    status: FormStatus;
    startsAt: string | null;
    endsAt: string | null;
}
