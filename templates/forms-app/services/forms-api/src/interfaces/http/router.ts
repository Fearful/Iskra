import { Hono } from 'hono';
import staticRoutes from './static.routes.ts';
import submitRoutes from './submit.routes.ts';

const router = new Hono();

// Submit routes first (more specific paths)
router.route('/', submitRoutes);
// Static file serving (catch-all for /:spaceSlug/:formSlug)
router.route('/', staticRoutes);

export default router;
