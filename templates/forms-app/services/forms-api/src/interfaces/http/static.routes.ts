import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { config } from '../../app.config.ts';

const app = new Hono();

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
                },
            });
        }
    } catch {}

    return c.json({ error: 'Form not found' }, 404);
});

export default app;
