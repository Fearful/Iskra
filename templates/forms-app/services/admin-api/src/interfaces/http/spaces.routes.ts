import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { SpaceService } from '../../domain/spaces/space.service.ts';

const app = new Hono();

const CreateSpaceSchema = z.object({
    name: z.string().min(1).max(255),
    slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
});

const UpdateSpaceSchema = z.object({
    name: z.string().min(1).max(255).optional(),
    slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).optional(),
});

app.get('/', async (c) => {
    const spaces = await SpaceService.findAll();
    return c.json({ data: spaces });
});

app.post('/', zValidator('json', CreateSpaceSchema), async (c) => {
    const input = c.req.valid('json');

    const existing = await SpaceService.findBySlug(input.slug);
    if (existing) {
        return c.json({ error: 'Space with this slug already exists' }, 409);
    }

    const space = await SpaceService.create(input);
    return c.json({ data: space }, 201);
});

app.get('/:id', async (c) => {
    const space = await SpaceService.findById(c.req.param('id'));
    if (!space) return c.json({ error: 'Space not found' }, 404);
    return c.json({ data: space });
});

app.put('/:id', zValidator('json', UpdateSpaceSchema), async (c) => {
    const id = c.req.param('id');
    const input = c.req.valid('json');
    const space = await SpaceService.update(id, input);
    if (!space) return c.json({ error: 'Space not found' }, 404);
    return c.json({ data: space });
});

app.delete('/:id', async (c) => {
    await SpaceService.delete(c.req.param('id'));
    return c.json({ data: { ok: true } });
});

export default app;
