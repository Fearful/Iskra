import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { config } from '../../app.config.ts';

const app = new Hono();

/**
 * The form pages had no Content-Security-Policy, so markup that got into one
 * (an escaping bug, a tampered build) could run scripts next to the CSRF and
 * reCAPTCHA tokens, and any site could frame them. A page needs only its own
 * bundle and stylesheet (no inline script or style), reCAPTCHA v3 (the script,
 * frame and connect sources Google documents for it) and forms-api's API.
 */
export const FORM_PAGE_CSP = [
    "default-src 'none'",
    "script-src 'self' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/",
    "style-src 'self'",
    "img-src 'self'",
    "connect-src 'self' https://www.google.com/recaptcha/",
    'frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/',
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
].join('; ');

// Serve prerendered form HTML and assets
// Route: /:spaceSlug/:formSlug → serves index.html
// Route: /:spaceSlug/:formSlug/assets/* → serves JS/CSS bundles
app.get('/:spaceSlug/:formSlug/assets/*', async (c) => {
    const spaceSlug = c.req.param('spaceSlug');
    const formSlug = c.req.param('formSlug');
    const assetPath = c.req.path.split('/assets/')[1];

    const filePath = `${config.staticDir}/${spaceSlug}/${formSlug}/assets/${assetPath}`;

    try {
        const file = Bun.file(filePath);
        if (await file.exists()) {
            return new Response(file, {
                headers: {
                    'Cache-Control': 'public, max-age=31536000, immutable',
                },
            });
        }
    } catch {}

    return c.json({ error: 'Not found' }, 404);
});

app.get('/:spaceSlug/:formSlug', async (c) => {
    const spaceSlug = c.req.param('spaceSlug');
    const formSlug = c.req.param('formSlug');

    const filePath = `${config.staticDir}/${spaceSlug}/${formSlug}/index.html`;

    try {
        const file = Bun.file(filePath);
        if (await file.exists()) {
            return new Response(file, {
                headers: {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Cache-Control': 'public, max-age=60',
                    'Content-Security-Policy': FORM_PAGE_CSP,
                    // For browsers without frame-ancestors (the Kernel's default is SAMEORIGIN).
                    'X-Frame-Options': 'DENY',
                },
            });
        }
    } catch {}

    return c.json({ error: 'Form not found' }, 404);
});

export default app;
