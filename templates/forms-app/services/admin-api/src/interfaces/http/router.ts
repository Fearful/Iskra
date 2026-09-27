import { Hono } from 'hono';
import spacesRoutes from './spaces.routes.ts';
import formsRoutes from './forms.routes.ts';
import answersRoutes from './answers.routes.ts';
import { config } from '../../app.config.ts';

const ALLOWED_ORIGINS = new Set(
    config.cors.origins
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
);
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const router = new Hono();

// The session cookie goes with any request from the browser, so a page on
// another origin (or a sibling subdomain, which counts as same-site for the
// cookie) could create, publish or delete. Better Auth checks the Origin of its
// own routes against trustedOrigins; these get the same list (CORS_ORIGINS).
// Browsers always send Origin on these methods; without it, Sec-Fetch-Site
// still tells a cross-site request apart. Clients that send neither (curl,
// scripts) are not browsers and carry no ambient cookie, so they pass.
router.use('*', async (c, next) => {
    if (STATE_CHANGING.has(c.req.method)) {
        const origin = c.req.header('origin');
        const fetchSite = c.req.header('sec-fetch-site');
        const allowed = origin ? ALLOWED_ORIGINS.has(origin) : fetchSite !== 'cross-site' && fetchSite !== 'same-site';
        if (!allowed) return c.json({ error: 'Forbidden' }, 403);
    }
    await next();
});

// Every admin endpoint needs a signed-in user. AuthFeature's global middleware
// resolves the session into `c.get('user')` before these routes run; its own
// routes (sign-in, sign-out, session) live under config.auth.basePath.
router.use('*', async (c, next) => {
    if (!c.get('user')) return c.json({ error: 'Unauthorized' }, 401);
    await next();
});

router.route('/spaces', spacesRoutes);
router.route('/', formsRoutes);
router.route('/', answersRoutes);

export default router;
