import { Hono } from 'hono';
import spacesRoutes from './spaces.routes.ts';
import formsRoutes from './forms.routes.ts';
import answersRoutes from './answers.routes.ts';

const router = new Hono();

router.route('/spaces', spacesRoutes);
router.route('/', formsRoutes);
router.route('/', answersRoutes);

export default router;
