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

export interface Form {
    id: string;
    spaceId: string;
    title: string;
    description: string | null;
    slug: string;
    schema: Record<string, unknown> | null;
    validationSchema: Record<string, unknown> | null;
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
