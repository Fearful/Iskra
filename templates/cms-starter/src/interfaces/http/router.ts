import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { ContentService, ContentError } from '../../domain/content/content.service.ts';
import { CreateContentSchema, UpdateContentSchema } from '../../domain/content/content.model.ts';

/** Mapea el codigo de error de dominio al status HTTP. */
const statusFor = (code: ContentError['code']): 404 | 409 | 422 =>
    code === 'NOT_FOUND' ? 404 : code === 'SLUG_TAKEN' ? 409 : 422;

export function createContentRouter(service: ContentService): Hono {
    const app = new Hono();

    // Listar, con filtros opcionales ?type=post&status=published
    app.get('/content', async (c) => {
        const type = c.req.query('type') as 'post' | 'page' | undefined;
        const status = c.req.query('status') as 'draft' | 'published' | undefined;
        return c.json(await service.findAll({ type, status }));
    });

    app.get('/content/:id', async (c) => {
        const item = await service.findById(c.req.param('id'));
        if (!item) return c.json({ error: 'Content not found' }, 404);
        return c.json(item);
    });

    // Historial de versiones de un documento
    app.get('/content/:id/versions', async (c) => {
        try {
            return c.json(await service.listVersions(c.req.param('id')));
        } catch (e) {
            if (e instanceof ContentError) return c.json({ error: e.message }, statusFor(e.code));
            throw e;
        }
    });

    app.post('/content', zValidator('json', CreateContentSchema), async (c) => {
        try {
            return c.json(await service.create(c.req.valid('json')), 201);
        } catch (e) {
            if (e instanceof ContentError) return c.json({ error: e.message }, statusFor(e.code));
            throw e;
        }
    });

    app.put('/content/:id', zValidator('json', UpdateContentSchema), async (c) => {
        try {
            return c.json(await service.update(c.req.param('id'), c.req.valid('json')));
        } catch (e) {
            if (e instanceof ContentError) return c.json({ error: e.message }, statusFor(e.code));
            throw e;
        }
    });

    // Workflow draft/publish
    app.post('/content/:id/publish', async (c) => {
        try {
            return c.json(await service.publish(c.req.param('id')));
        } catch (e) {
            if (e instanceof ContentError) return c.json({ error: e.message }, statusFor(e.code));
            throw e;
        }
    });

    app.post('/content/:id/unpublish', async (c) => {
        try {
            return c.json(await service.unpublish(c.req.param('id')));
        } catch (e) {
            if (e instanceof ContentError) return c.json({ error: e.message }, statusFor(e.code));
            throw e;
        }
    });

    app.delete('/content/:id', async (c) => {
        try {
            await service.delete(c.req.param('id'));
            return c.json({ success: true });
        } catch (e) {
            if (e instanceof ContentError) return c.json({ error: e.message }, statusFor(e.code));
            throw e;
        }
    });

    return app;
}
