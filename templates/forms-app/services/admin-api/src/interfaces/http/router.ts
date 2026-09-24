import { Hono } from 'hono';
import spacesRoutes from './spaces.routes.ts';
import formsRoutes from './forms.routes.ts';
import answersRoutes from './answers.routes.ts';

const router = new Hono();

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
