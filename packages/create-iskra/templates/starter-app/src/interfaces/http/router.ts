import { createRouter, defineRoute } from '@iskra-bun/web-kit';
import { z } from 'zod';
import { UserService } from '../../domain/user.service';

const userService = new UserService();

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
            body: z.object({ name: z.string() }),
        },
        handler: async (ctx) => {
            const user = await userService.create(ctx.body.name);
            return user;
        },
    }),
]);
