import type { DbDriver } from '@iskra-bun/db-kit';
import { eq, sql, desc } from 'drizzle-orm';
import { content, contentVersions, type ContentRow, type ContentVersionRow } from '../../db/schema';
import type { CreateContentInput, UpdateContentInput } from './content.model';

/** Errores de dominio con codigo, para que la capa HTTP elija el status. */
export class ContentError extends Error {
    constructor(
        message: string,
        readonly code: 'NOT_FOUND' | 'SLUG_TAKEN' | 'INVALID_STATE',
    ) {
        super(message);
        this.name = 'ContentError';
    }
}

export class ContentService {
    constructor(private readonly db: DbDriver) {}

    /** Crea las tablas si no existen. Llamado una vez al arrancar la App. */
    async initTables() {
        await this.db.db.run(sql`
            CREATE TABLE IF NOT EXISTS content (
                id TEXT PRIMARY KEY,
                slug TEXT UNIQUE NOT NULL,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'draft',
                version INTEGER NOT NULL DEFAULT 1,
                published_at INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
        `);
        await this.db.db.run(sql`
            CREATE TABLE IF NOT EXISTS content_versions (
                id TEXT PRIMARY KEY,
                content_id TEXT NOT NULL,
                version INTEGER NOT NULL,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )
        `);
    }

    async findAll(filter?: { type?: 'post' | 'page'; status?: 'draft' | 'published' }): Promise<ContentRow[]> {
        const rows: ContentRow[] = await this.db.db.select().from(content).orderBy(desc(content.updatedAt));
        return rows.filter(
            (r) => (!filter?.type || r.type === filter.type) && (!filter?.status || r.status === filter.status),
        );
    }

    async findById(id: string): Promise<ContentRow | undefined> {
        const rows: ContentRow[] = await this.db.db.select().from(content).where(eq(content.id, id)).limit(1);
        return rows[0];
    }

    async findBySlug(slug: string): Promise<ContentRow | undefined> {
        const rows: ContentRow[] = await this.db.db.select().from(content).where(eq(content.slug, slug)).limit(1);
        return rows[0];
    }

    async listVersions(id: string): Promise<ContentVersionRow[]> {
        const exists = await this.findById(id);
        if (!exists) throw new ContentError(`Contenido ${id} no encontrado`, 'NOT_FOUND');
        return this.db.db
            .select()
            .from(contentVersions)
            .where(eq(contentVersions.contentId, id))
            .orderBy(desc(contentVersions.version));
    }

    async create(input: CreateContentInput): Promise<ContentRow> {
        if (await this.findBySlug(input.slug)) {
            throw new ContentError(`El slug "${input.slug}" ya está en uso`, 'SLUG_TAKEN');
        }

        const now = new Date();
        const row: ContentRow = {
            id: crypto.randomUUID(),
            slug: input.slug,
            title: input.title,
            body: input.body,
            type: input.type,
            status: 'draft',
            version: 1,
            publishedAt: null,
            createdAt: now,
            updatedAt: now,
        };

        await this.db.db.insert(content).values(row);
        await this.snapshot(row);
        return row;
    }

    async update(id: string, input: UpdateContentInput): Promise<ContentRow> {
        const current = await this.findById(id);
        if (!current) throw new ContentError(`Contenido ${id} no encontrado`, 'NOT_FOUND');

        // Si cambia el slug, validar unicidad contra otros documentos.
        if (input.slug && input.slug !== current.slug) {
            const clash = await this.findBySlug(input.slug);
            if (clash && clash.id !== id) {
                throw new ContentError(`El slug "${input.slug}" ya está en uso`, 'SLUG_TAKEN');
            }
        }

        const next: ContentRow = {
            ...current,
            slug: input.slug ?? current.slug,
            title: input.title ?? current.title,
            body: input.body ?? current.body,
            type: input.type ?? current.type,
            version: current.version + 1,
            updatedAt: new Date(),
        };

        await this.db.db.update(content).set(next).where(eq(content.id, id));
        await this.snapshot(next);
        return next;
    }

    /** Transicion draft → published. Idempotente: re-publicar refresca publishedAt. */
    async publish(id: string): Promise<ContentRow> {
        const current = await this.findById(id);
        if (!current) throw new ContentError(`Contenido ${id} no encontrado`, 'NOT_FOUND');

        const now = new Date();
        const next: ContentRow = {
            ...current,
            status: 'published',
            version: current.version + 1,
            publishedAt: now,
            updatedAt: now,
        };

        await this.db.db.update(content).set(next).where(eq(content.id, id));
        await this.snapshot(next);
        return next;
    }

    /** Transicion published → draft. Falla si ya es draft. */
    async unpublish(id: string): Promise<ContentRow> {
        const current = await this.findById(id);
        if (!current) throw new ContentError(`Contenido ${id} no encontrado`, 'NOT_FOUND');
        if (current.status !== 'published') {
            throw new ContentError('El contenido no está publicado', 'INVALID_STATE');
        }

        const next: ContentRow = {
            ...current,
            status: 'draft',
            version: current.version + 1,
            publishedAt: null,
            updatedAt: new Date(),
        };

        await this.db.db.update(content).set(next).where(eq(content.id, id));
        await this.snapshot(next);
        return next;
    }

    async delete(id: string): Promise<void> {
        const current = await this.findById(id);
        if (!current) throw new ContentError(`Contenido ${id} no encontrado`, 'NOT_FOUND');
        await this.db.db.delete(content).where(eq(content.id, id));
        await this.db.db.delete(contentVersions).where(eq(contentVersions.contentId, id));
    }

    /** Inserta una fila inmutable en el historial reflejando el estado actual. */
    private async snapshot(row: ContentRow): Promise<void> {
        const version: ContentVersionRow = {
            id: crypto.randomUUID(),
            contentId: row.id,
            version: row.version,
            title: row.title,
            body: row.body,
            status: row.status,
            createdAt: new Date(),
        };
        await this.db.db.insert(contentVersions).values(version);
    }
}
