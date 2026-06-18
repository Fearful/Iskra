import { forms, formFields, answers } from '@forms-app/shared/db';
import { eq, and, sql, desc } from 'drizzle-orm';
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
import type { FieldType } from '@forms-app/shared';

export class FormService {
    private static db: any;

    static setDb(db: any) {
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
            schema: input.fields as any,
            validationSchema,
            startsAt: input.startsAt ? new Date(input.startsAt) : null,
            endsAt: input.endsAt ? new Date(input.endsAt) : null,
            status: 'draft',
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await this.db.insert(forms).values(form);

        if (fieldRecords.length > 0) {
            await this.db.insert(formFields).values(fieldRecords);
        }

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

        if (input.fields) {
            // Replace all fields
            await this.db.delete(formFields).where(eq(formFields.formId, id));

            const fieldRecords: FormField[] = input.fields.map((f) => {
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

            if (fieldRecords.length > 0) {
                await this.db.insert(formFields).values(fieldRecords);
            }

            // Regenerate validation schema
            updates.validationSchema = generateJsonSchema(fieldRecords);
            updates.schema = input.fields as any;
        }

        await this.db.update(forms).set(updates).where(eq(forms.id, id));

        return this.findById(id);
    }

    static async delete(id: string): Promise<void> {
        await this.db.delete(forms).where(eq(forms.id, id));
    }

    static async setStatus(id: string, status: string): Promise<void> {
        await this.db
            .update(forms)
            .set({ status, updatedAt: new Date() })
            .where(eq(forms.id, id));
    }

    static async getAnswers(
        formId: string,
        page = 1,
        pageSize = 50,
    ): Promise<PaginatedResponse<Answer>> {
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
