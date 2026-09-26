import { pgTable, text, timestamp, integer, jsonb, pgEnum, uniqueIndex, boolean } from 'drizzle-orm/pg-core';
import type { CreateFieldInput, FieldOption, JsonSchema } from '../types/form.ts';

export const formStatusEnum = pgEnum('form_status', ['draft', 'scheduled', 'open', 'closed']);

export const fieldTypeEnum = pgEnum('field_type', [
    'text',
    'number',
    'email',
    'select',
    'checkbox',
    'radio',
    'textarea',
    'date',
]);

export const spaces = pgTable('spaces', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const forms = pgTable(
    'forms',
    {
        id: text('id').primaryKey(),
        spaceId: text('space_id')
            .notNull()
            .references(() => spaces.id, { onDelete: 'cascade' }),
        title: text('title').notNull(),
        description: text('description'),
        slug: text('slug').notNull(),
        schema: jsonb('schema').$type<CreateFieldInput[]>(),
        validationSchema: jsonb('validation_schema').$type<JsonSchema>(),
        startsAt: timestamp('starts_at'),
        endsAt: timestamp('ends_at'),
        status: formStatusEnum('status').notNull().default('draft'),
        createdAt: timestamp('created_at').defaultNow().notNull(),
        updatedAt: timestamp('updated_at').defaultNow().notNull(),
    },
    (table) => [uniqueIndex('forms_space_slug_idx').on(table.spaceId, table.slug)],
);

export const formFields = pgTable('form_fields', {
    id: text('id').primaryKey(),
    formId: text('form_id')
        .notNull()
        .references(() => forms.id, { onDelete: 'cascade' }),
    fieldType: fieldTypeEnum('field_type').notNull(),
    label: text('label').notNull(),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    required: boolean('required').notNull().default(false),
    options: jsonb('options').$type<FieldOption[]>(),
    maxLength: integer('max_length'),
    min: integer('min'),
    max: integer('max'),
    placeholder: text('placeholder'),
    helpText: text('help_text'),
    errorMessage: text('error_message'),
});

export const answers = pgTable('answers', {
    id: text('id').primaryKey(),
    formId: text('form_id')
        .notNull()
        .references(() => forms.id, { onDelete: 'cascade' }),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    submittedAt: timestamp('submitted_at').defaultNow().notNull(),
    ipHash: text('ip_hash'),
    recaptchaScore: integer('recaptcha_score'),
});
