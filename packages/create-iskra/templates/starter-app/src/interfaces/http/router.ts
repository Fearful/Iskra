import { createRouter, defineRoute } from '@iskra-bun/web-kit';
import { z } from 'zod';
import { UserService } from '../../domain/user.service';

const userService = new UserService();

/** A bounded name: without `.max()` a single request could store megabytes. */
export const CreateUserSchema = z.object({ name: z.string().trim().min(1).max(100) });

export const httpRouter = createRouter([
    {
        method: 'GET',
        path: '/users',
        handler: async () => {
            return await userService.findAll();
        },
    },
    // defineRoute() types ctx.body from the schema: { name: string }.
    defineRoute({
        method: 'POST',
        path: '/users',
        schema: {
            body: CreateUserSchema,
        },
        handler: async (ctx) => {
            const user = await userService.create(ctx.body.name);
            if (!user) return ctx.raw.json({ error: 'User limit reached' }, 507);
            return user;
        },
    }),
]);
