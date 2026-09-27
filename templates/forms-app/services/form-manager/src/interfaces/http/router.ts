import { Hono } from 'hono';
import { hasInternalApiToken } from '@forms-app/shared/internal-api';
import { config } from '../../app.config.ts';
import { PrerenderService } from '../../domain/prerender/prerender.service.ts';
import { LifecycleService } from '../../domain/lifecycle/lifecycle.service.ts';

const app = new Hono();

// Only admin-api and cron call these, with INTERNAL_API_TOKEN: they used to
// answer anyone who reached the service, and remove deletes a form's page.
app.use('/internal/*', async (c, next) => {
    if (!hasInternalApiToken(c.req.header('Authorization'), config.internalApiToken)) {
        return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
});

app.post('/internal/prerender/:formId', async (c) => {
    const formId = c.req.param('formId');
    try {
        const result = await PrerenderService.prerenderForm(formId);
        return c.json({ data: result });
    } catch (err) {
        console.error('Prerender failed:', err);
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
});

app.post('/internal/lifecycle/open', async (c) => {
    const { formId } = await c.req.json();
    try {
        await LifecycleService.openForm(formId);
        return c.json({ data: { ok: true } });
    } catch (err) {
        console.error('Open form failed:', err);
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
});

app.post('/internal/lifecycle/close', async (c) => {
    const { formId } = await c.req.json();
    try {
        await LifecycleService.closeForm(formId);
        return c.json({ data: { ok: true } });
    } catch (err) {
        console.error('Close form failed:', err);
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
});

app.post('/internal/lifecycle/remove', async (c) => {
    const { spaceSlug, formSlug } = await c.req.json();
    try {
        await LifecycleService.removeForm(String(spaceSlug), String(formSlug));
        return c.json({ data: { ok: true } });
    } catch (err) {
        console.error('Remove form failed:', err);
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
});

export default app;
