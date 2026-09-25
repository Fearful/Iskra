export const FormStatus = {
    DRAFT: 'draft',
    SCHEDULED: 'scheduled',
    OPEN: 'open',
    CLOSED: 'closed',
} as const;

export type FormStatus = (typeof FormStatus)[keyof typeof FormStatus];

export const FieldType = {
    TEXT: 'text',
    NUMBER: 'number',
    EMAIL: 'email',
    SELECT: 'select',
    CHECKBOX: 'checkbox',
    RADIO: 'radio',
    TEXTAREA: 'textarea',
    DATE: 'date',
} as const;

export type FieldType = (typeof FieldType)[keyof typeof FieldType];

export const FIELD_TYPES = Object.values(FieldType);
export const FORM_STATUSES = Object.values(FormStatus);

export const REDIS_KEYS = {
    formSchema: (spaceSlug: string, formSlug: string) => `forms:schema:${spaceSlug}:${formSlug}`,
    formMeta: (spaceSlug: string, formSlug: string) => `forms:meta:${spaceSlug}:${formSlug}`,
    formIndex: 'forms:index',
} as const;

export const QUEUE_NAMES = {
    ANSWERS: 'forms-answers',
} as const;

export const JOB_NAMES = {
    ANSWER_SUBMIT: 'answer.submit',
} as const;

/** The reCAPTCHA v3 action a form page requests its token for, and forms-api requires. */
export const RECAPTCHA_ACTION = 'submit';
