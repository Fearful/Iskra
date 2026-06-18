import { Hono } from 'hono';
import { FormService } from '../../domain/forms/form.service.ts';

const app = new Hono();

app.get('/forms/:id/answers', async (c) => {
    const formId = c.req.param('id');
    const page = Number(c.req.query('page') || '1');
    const pageSize = Math.min(Number(c.req.query('pageSize') || '50'), 100);

    const result = await FormService.getAnswers(formId, page, pageSize);
    return c.json(result);
});

export default app;
