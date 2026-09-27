import { forms, formFields, answers } from '@forms-app/shared/db';
import { eq, sql, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import type {
    Form,
    FormWithFields,
    FormField,
    CreateFormInput,
    UpdateFormInput,
    Answer,
    PaginatedResponse,
} from '@forms-app/shared';
import { generateJsonSchema } from './schema-generator.ts';
import { enforceConstraints } from '@forms-app/shared/validation';
import type { FieldType, FormStatus } from '@forms-app/shared';
import type { FormsDb } from '@forms-app/shared/db/client';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
// Keeps the OFFSET a safe integer (and within Postgres' bigint).
const MAX_PAGE = Math.floor(Number.MAX_SAFE_INTEGER / MAX_PAGE_SIZE);

/**
 * A page of answers that can be queried: whole numbers, page >= 1 and
 * pageSize 1..100, the defaults for anything that is not a number. page=-1
 * made a negative OFFSET and a pageSize that was not a number a LIMIT of NaN,
 * which failed in Postgres with a 500.
 */
export function normalizePagination(page: number, pageSize: number): { page: number; pageSize: number } {
    const clamp = (value: number, fallback: number, max: number) =>
        Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 1), max) : fallback;
    return { page: clamp(page, 1, MAX_PAGE), pageSize: clamp(pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE) };
}

export class FormService {
    private static db: FormsDb;

    static setDb(db: FormsDb) {
        this.db = db;
    }

    static async findBySpaceId(spaceId: string): Promise<Form[]> {
        return this.db.select().from(forms).where(eq(forms.spaceId, spaceId));
    }

    static async findById(id: string): Promise<FormWithFields | undefined> {
        const formResults = await this.db.select().from(forms).where(eq(forms.id, id));
        const form = formResults[0];
        if (!form) return undefined;

        const fields = await this.db
            .select()
            .from(formFields)
            .where(eq(formFields.formId, id))
            .orderBy(formFields.position);

        return { ...form, fields };
    }

    static async create(spaceId: string, input: CreateFormInput): Promise<FormWithFields> {
        const formId = uuidv4();

        // Build fields with enforced constraints
        const fieldRecords: FormField[] = input.fields.map((f) => {
            const enforced = enforceConstraints(f.fieldType as FieldType, {
                maxLength: f.maxLength,
                min: f.min,
                max: f.max,
                options: f.options,
            });

            return {
                id: uuidv4(),
                formId,
                fieldType: f.fieldType,
                label: f.label,
                name: f.name,
                position: f.position,
                required: f.required ?? false,
                options: f.options ?? null,
                maxLength: enforced.maxLength ?? f.maxLength ?? null,
                min: enforced.min ?? f.min ?? null,
                max: enforced.max ?? f.max ?? null,
                placeholder: f.placeholder ?? null,
                helpText: f.helpText ?? null,
                errorMessage: f.errorMessage ?? null,
            };
        });

        // Generate JSON Schema from fields
        const validationSchema = generateJsonSchema(fieldRecords);

        const form: Form = {
            id: formId,
            spaceId,
            title: input.title,
            description: input.description ?? null,
            slug: input.slug,
            schema: input.fields,
            validationSchema,
            startsAt: input.startsAt ? new Date(input.startsAt) : null,
            endsAt: input.endsAt ? new Date(input.endsAt) : null,
            status: 'draft',
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        // One transaction: a failed field insert used to leave a form without fields.
        await this.db.transaction(async (tx) => {
            await tx.insert(forms).values(form);
            if (fieldRecords.length > 0) {
                await tx.insert(formFields).values(fieldRecords);
            }
        });

        return { ...form, fields: fieldRecords };
    }

    static async update(id: string, input: UpdateFormInput): Promise<FormWithFields | undefined> {
        const existing = await this.findById(id);
        if (!existing) return undefined;

        const updates: Partial<Form> = {
            updatedAt: new Date(),
        };

        if (input.title !== undefined) updates.title = input.title;
        if (input.slug !== undefined) updates.slug = input.slug;
        if (input.description !== undefined) updates.description = input.description;
        if (input.startsAt !== undefined) updates.startsAt = new Date(input.startsAt);
        if (input.endsAt !== undefined) updates.endsAt = new Date(input.endsAt);

        let fieldRecords: FormField[] | undefined;
        if (input.fields) {
            fieldRecords = input.fields.map((f): FormField => {
                const enforced = enforceConstraints(f.fieldType as FieldType, {
                    maxLength: f.maxLength,
                    min: f.min,
                    max: f.max,
                    options: f.options,
                });

                return {
                    id: uuidv4(),
                    formId: id,
                    fieldType: f.fieldType,
                    label: f.label,
                    name: f.name,
                    position: f.position,
                    required: f.required ?? false,
                    options: f.options ?? null,
                    maxLength: enforced.maxLength ?? f.maxLength ?? null,
                    min: enforced.min ?? f.min ?? null,
                    max: enforced.max ?? f.max ?? null,
                    placeholder: f.placeholder ?? null,
                    helpText: f.helpText ?? null,
                    errorMessage: f.errorMessage ?? null,
                };
            });

            // Regenerate validation schema
            updates.validationSchema = generateJsonSchema(fieldRecords);
            updates.schema = input.fields;
        }

        // One transaction: the fields used to be deleted first, so a failed
        // insert left the form with none.
        await this.db.transaction(async (tx) => {
            if (fieldRecords) {
                await tx.delete(formFields).where(eq(formFields.formId, id));
                if (fieldRecords.length > 0) {
                    await tx.insert(formFields).values(fieldRecords);
                }
            }
            await tx.update(forms).set(updates).where(eq(forms.id, id));
        });

        return this.findById(id);
    }

    static async delete(id: string): Promise<void> {
        await this.db.delete(forms).where(eq(forms.id, id));
    }

    static async setStatus(id: string, status: FormStatus): Promise<void> {
        await this.db.update(forms).set({ status, updatedAt: new Date() }).where(eq(forms.id, id));
    }

    static async getAnswers(
        formId: string,
        requestedPage = 1,
        requestedPageSize = DEFAULT_PAGE_SIZE,
    ): Promise<PaginatedResponse<Answer>> {
        const { page, pageSize } = normalizePagination(requestedPage, requestedPageSize);
        const offset = (page - 1) * pageSize;

        const [data, countResult] = await Promise.all([
            this.db
                .select()
                .from(answers)
                .where(eq(answers.formId, formId))
                .orderBy(desc(answers.submittedAt))
                .limit(pageSize)
                .offset(offset),
            this.db
                .select({ count: sql<number>`count(*)` })
                .from(answers)
                .where(eq(answers.formId, formId)),
        ]);

        return {
            data,
            total: Number(countResult[0]?.count ?? 0),
            page,
            pageSize,
        };
    }
}
