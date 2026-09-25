import { Hono } from 'hono';
import { FormService } from '../../domain/forms/form.service.ts';

const app = new Hono();

app.get('/forms/:id/answers', async (c) => {
    const formId = c.req.param('id');
    // Missing or not a number: NaN, which getAnswers replaces with its default.
    const page = Number(c.req.query('page') || NaN);
    const pageSize = Number(c.req.query('pageSize') || NaN);

    const result = await FormService.getAnswers(formId, page, pageSize);
    return c.json(result);
});

export default app;
