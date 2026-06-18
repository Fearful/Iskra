import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/**
 * Tabla principal de contenido. Cada fila es la "cabeza" de un documento:
 * su estado actual (draft/published) y el cuerpo vigente. El historial vive
 * en `content_versions`.
 */
export const content = sqliteTable('content', {
    id: text('id').primaryKey(),
    slug: text('slug').unique().notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    type: text('type').notNull(), // 'post' | 'page'
    status: text('status').notNull().default('draft'), // 'draft' | 'published'
    version: integer('version').notNull().default(1),
    publishedAt: integer('published_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

/**
 * Historial inmutable de versiones. Se inserta una fila cada vez que el
 * contenido cambia (create, update, publish), nunca se actualiza.
 */
export const contentVersions = sqliteTable('content_versions', {
    id: text('id').primaryKey(),
    contentId: text('content_id').notNull(),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    status: text('status').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export type ContentRow = typeof content.$inferSelect;
export type ContentVersionRow = typeof contentVersions.$inferSelect;
