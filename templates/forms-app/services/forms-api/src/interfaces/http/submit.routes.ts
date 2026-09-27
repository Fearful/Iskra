import { Hono } from 'hono';
import { getClientIp } from '@iskra-bun/web-kit';
import { config } from '../../app.config.ts';
import { FormStatus } from '@forms-app/shared';
import { RecaptchaService } from '../../domain/recaptcha/recaptcha.service.ts';
import { SubmissionService } from '../../domain/submission/submission.service.ts';

const app = new Hono();

// CSRF token endpoint
app.get('/api/csrf-token', (c) => {
    // The CsrfFeature middleware sets the token cookie
    // We return the token value so the client JS can read it
    const token = c.get('csrfToken') || '';
    return c.json({ token });
});

// Submit form answer
app.post('/api/submit/:spaceSlug/:formSlug', async (c) => {
    const spaceSlug = c.req.param('spaceSlug');
    const formSlug = c.req.param('formSlug');

    // 1. Parse body
    let body: { data: Record<string, unknown>; recaptchaToken: string };
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: 'Invalid JSON body' }, 400);
    }

    if (!body.data || typeof body.data !== 'object') {
        return c.json({ error: 'Missing data field' }, 400);
    }

    if (!body.recaptchaToken) {
        return c.json({ error: 'Missing reCAPTCHA token' }, 400);
    }

    // 2. Get form data from Redis
    const formData = await SubmissionService.getFormData(spaceSlug, formSlug);
    if (!formData) {
        return c.json({ error: 'Form not found' }, 404);
    }

    // 3. Check form is open
    if (formData.meta.status !== FormStatus.OPEN) {
        return c.json({ error: 'Form is not currently accepting submissions' }, 403);
    }

    // 4. Verify reCAPTCHA
    const recaptchaResult = await RecaptchaService.verify(body.recaptchaToken);
    if (!recaptchaResult.valid) {
        return c.json({ error: 'reCAPTCHA verification failed' }, 403);
    }

    // 5. Server-side validation with AJV (using errorMessages from JSON Schema)
    const validation = SubmissionService.validateAnswer(formData.schema, body.data);
    if (!validation.valid) {
        return c.json({ error: 'Validation failed', errors: validation.errors }, 422);
    }

    // 6. Hash IP
    // The address nginx saw, not the first X-Forwarded-For entry (which the
    // client writes).
    const ip = getClientIp(c, config.web.trustProxy) ?? 'unknown';
    const ipHash = SubmissionService.hashIp(ip, config.ipHashSecret);

    // 7. Enqueue answer
    try {
        await SubmissionService.enqueueAnswer(formData.meta.formId, body.data, ipHash, recaptchaResult.score);
    } catch (err) {
        console.error('Failed to enqueue answer:', err);
        return c.json({ error: 'Submission failed, please try again' }, 500);
    }

    return c.json({ data: { submitted: true } }, 202);
});

export default app;
