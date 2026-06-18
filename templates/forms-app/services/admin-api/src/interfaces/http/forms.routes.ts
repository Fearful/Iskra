import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { FormService } from '../../domain/forms/form.service.ts';
import { FIELD_TYPES } from '@forms-app/shared';
import { config } from '../../app.config.ts';

const app = new Hono();

const FieldOptionSchema = z.object({
    label: z.string().min(1),
    value: z.string().min(1),
});

const CreateFieldSchema = z.object({
    fieldType: z.enum(FIELD_TYPES as [string, ...string[]]),
    label: z.string().min(1).max(255),
    name: z.string().min(1).max(100).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
    position: z.number().int().min(0),
    required: z.boolean().optional(),
    options: z.array(FieldOptionSchema).optional(),
    maxLength: z.number().int().positive().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    placeholder: z.string().max(500).optional(),
    helpText: z.string().max(1000).optional(),
    errorMessage: z.string().max(500).optional(),
});

const CreateFormSchema = z.object({
    title: z.string().min(1).max(255),
    slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
    description: z.string().max(5000).optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    fields: z.array(CreateFieldSchema).min(1),
});

const UpdateFormSchema = z.object({
    title: z.string().min(1).max(255).optional(),
    slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).optional(),
    description: z.string().max(5000).optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    fields: z.array(CreateFieldSchema).optional(),
});

// List forms in a space
app.get('/spaces/:spaceId/forms', async (c) => {
    const forms = await FormService.findBySpaceId(c.req.param('spaceId'));
    return c.json({ data: forms });
});

// Create form in a space
app.post('/spaces/:spaceId/forms', zValidator('json', CreateFormSchema), async (c) => {
    const spaceId = c.req.param('spaceId');
    const input = c.req.valid('json');
    const form = await FormService.create(spaceId, input);
    return c.json({ data: form }, 201);
});

// Get form by ID
app.get('/forms/:id', async (c) => {
    const form = await FormService.findById(c.req.param('id'));
    if (!form) return c.json({ error: 'Form not found' }, 404);
    return c.json({ data: form });
});

// Update form
app.put('/forms/:id', zValidator('json', UpdateFormSchema), async (c) => {
    const form = await FormService.update(c.req.param('id'), c.req.valid('json'));
    if (!form) return c.json({ error: 'Form not found' }, 404);
    return c.json({ data: form });
});

// Delete form
app.delete('/forms/:id', async (c) => {
    await FormService.delete(c.req.param('id'));
    return c.json({ data: { ok: true } });
});

// Publish form (set to scheduled, trigger prerender)
app.post('/forms/:id/publish', async (c) => {
    const id = c.req.param('id');
    const form = await FormService.findById(id);
    if (!form) return c.json({ error: 'Form not found' }, 404);

    if (form.status !== 'draft') {
        return c.json({ error: 'Only draft forms can be published' }, 400);
    }

    await FormService.setStatus(id, 'scheduled');

    // Trigger prerender
    try {
        await fetch(`${config.formManagerUrl}/internal/prerender/${id}`, { method: 'POST' });
    } catch (err) {
        console.error('Failed to trigger prerender:', err);
    }

    return c.json({ data: { status: 'scheduled' } });
});

// Trigger prerender manually
app.post('/forms/:id/prerender', async (c) => {
    const id = c.req.param('id');
    try {
        const res = await fetch(`${config.formManagerUrl}/internal/prerender/${id}`, { method: 'POST' });
        const data = await res.json();
        return c.json({ data });
    } catch (err: any) {
        return c.json({ error: 'Failed to trigger prerender', details: err.message }, 502);
    }
});

export default app;
