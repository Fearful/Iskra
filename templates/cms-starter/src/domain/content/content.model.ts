import { z } from 'zod';

/** Slug URL-safe: minusculas, numeros y guiones. No empieza/termina en guion. */
export const SlugSchema = z
    .string()
    .min(1, 'El slug no puede estar vacío')
    .max(120, 'El slug es demasiado largo')
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug inválido: usá minúsculas, números y guiones (ej: "mi-primer-post")');

export const ContentStatus = z.enum(['draft', 'published']);
export type ContentStatus = z.infer<typeof ContentStatus>;

export const ContentType = z.enum(['post', 'page']);
export type ContentType = z.infer<typeof ContentType>;

export const ContentSchema = z.object({
    id: z.string().uuid(),
    slug: SlugSchema,
    title: z.string().min(1),
    body: z.string(),
    type: ContentType,
    status: ContentStatus,
    version: z.number().int().positive(),
    publishedAt: z.date().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
});

export type Content = z.infer<typeof ContentSchema>;

export const CreateContentSchema = z.object({
    slug: SlugSchema,
    title: z.string().min(1, 'El título es obligatorio'),
    body: z.string().default(''),
    type: ContentType,
});

export type CreateContentInput = z.infer<typeof CreateContentSchema>;

/** En update todo es opcional; el slug, si viene, se revalida. */
export const UpdateContentSchema = z
    .object({
        slug: SlugSchema.optional(),
        title: z.string().min(1).optional(),
        body: z.string().optional(),
        type: ContentType.optional(),
    })
    .refine((data) => Object.keys(data).length > 0, { message: 'Nada para actualizar' });

export type UpdateContentInput = z.infer<typeof UpdateContentSchema>;

/** Genera un slug candidato a partir de un titulo (helper para clientes). */
export function slugify(title: string): string {
    return title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '') // quitar acentos
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120);
}
