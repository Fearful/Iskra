import { Hono } from 'hono';
import { PrerenderService } from '../../domain/prerender/prerender.service.ts';
import { LifecycleService } from '../../domain/lifecycle/lifecycle.service.ts';

const app = new Hono();

app.post('/internal/prerender/:formId', async (c) => {
    const formId = c.req.param('formId');
    try {
        const result = await PrerenderService.prerenderForm(formId);
        return c.json({ data: result });
    } catch (err: any) {
        console.error('Prerender failed:', err);
        return c.json({ error: err.message }, 500);
    }
});

app.post('/internal/lifecycle/open', async (c) => {
    const { formId } = await c.req.json();
    try {
        await LifecycleService.openForm(formId);
        return c.json({ data: { ok: true } });
    } catch (err: any) {
        console.error('Open form failed:', err);
        return c.json({ error: err.message }, 500);
    }
});

app.post('/internal/lifecycle/close', async (c) => {
    const { formId } = await c.req.json();
    try {
        await LifecycleService.closeForm(formId);
        return c.json({ data: { ok: true } });
    } catch (err: any) {
        console.error('Close form failed:', err);
        return c.json({ error: err.message }, 500);
    }
});

export default app;
