import { Hono, type MiddlewareHandler } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { requireScope } from '@iskra-bun/web-kit';
import { ContentService, ContentError } from '../../domain/content/content.service.ts';
import {
    ContentStatus,
    ContentType,
    CreateContentSchema,
    UpdateContentSchema,
} from '../../domain/content/content.model.ts';
import { canReadDrafts } from '../../auth.ts';

/** Mapea el codigo de error de dominio al status HTTP. */
const statusFor = (code: ContentError['code']): 404 | 409 | 422 =>
    code === 'NOT_FOUND' ? 404 : code === 'SLUG_TAKEN' ? 409 : 422;

// Escribir, publicar y leer borradores o el historial: solo editores (ver
// src/auth.ts). Tipadas como MiddlewareHandler para que las rutas conserven
// el tipo de `c.req.param()`.
const editorsOnly: MiddlewareHandler = requireScope('content:write');
const draftReaders: MiddlewareHandler = requireScope('content:read:drafts');

/**
 * Publicar y despublicar no llevan cuerpo: sin esto, un <form method="post">
 * de otro sitio podria dispararlos si la app pasa a autenticar con cookies.
 * Exigir JSON obliga al navegador a un preflight de CORS.
 */
const requireJson: MiddlewareHandler = async (c, next) => {
    if (!/^application\/json\b/i.test(c.req.header('content-type') ?? '')) {
        return c.json({ error: 'Content-Type must be application/json' }, 415);
    }
    await next();
};

export function createContentRouter(service: ContentService): Hono {
    const app = new Hono();

    // Listar, con filtros opcionales ?type=post&status=published. El publico ve
    // solo lo publicado, lo pida o no; los editores pueden filtrar por estado.
    app.get('/content', async (c) => {
        const type = ContentType.safeParse(c.req.query('type')).data;
        const status = canReadDrafts(c) ? ContentStatus.safeParse(c.req.query('status')).data : 'published';
        return c.json(await service.findAll({ type, status }));
    });

    // Un borrador no existe para el publico: 404, igual que un id desconocido.
    app.get('/content/:id', async (c) => {
        const item = await service.findById(c.req.param('id'));
        if (!item || (item.status !== 'published' && !canReadDrafts(c))) {
            return c.json({ error: 'Content not found' }, 404);
        }
        return c.json(item);
    });

    // Historial de versiones de un documento (incluye borradores): solo editores.
    app.get('/content/:id/versions', draftReaders, async (c) => {
        try {
            return c.json(await service.listVersions(c.req.param('id')));
        } catch (e) {
            if (e instanceof ContentError) return c.json({ error: e.message }, statusFor(e.code));
            throw e;
        }
    });

    app.post('/content', editorsOnly, zValidator('json', CreateContentSchema), async (c) => {
        try {
            return c.json(await service.create(c.req.valid('json')), 201);
        } catch (e) {
            if (e instanceof ContentError) return c.json({ error: e.message }, statusFor(e.code));
            throw e;
        }
    });

    app.put('/content/:id', editorsOnly, zValidator('json', UpdateContentSchema), async (c) => {
        try {
            return c.json(await service.update(c.req.param('id'), c.req.valid('json')));
        } catch (e) {
            if (e instanceof ContentError) return c.json({ error: e.message }, statusFor(e.code));
            throw e;
        }
    });

    // Workflow draft/publish
    app.post('/content/:id/publish', editorsOnly, requireJson, async (c) => {
        try {
            return c.json(await service.publish(c.req.param('id')));
        } catch (e) {
            if (e instanceof ContentError) return c.json({ error: e.message }, statusFor(e.code));
            throw e;
        }
    });

    app.post('/content/:id/unpublish', editorsOnly, requireJson, async (c) => {
        try {
            return c.json(await service.unpublish(c.req.param('id')));
        } catch (e) {
            if (e instanceof ContentError) return c.json({ error: e.message }, statusFor(e.code));
            throw e;
        }
    });

    app.delete('/content/:id', editorsOnly, async (c) => {
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
