import { defineRoute } from '@iskra-bun/web-kit';
import { z } from 'zod';
import type { UserService } from '../../domain/user.service';

/** POST /users body. Without a schema ctx.body was undefined and every POST failed with 500. */
export const CreateUserSchema = z.object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().email().max(254),
});

export function createRouter(userService: UserService) {
    return [
        defineRoute({
            method: 'GET',
            path: '/users',
            // Public listing: ids and names only, never the emails.
            handler: async () => ({ users: await userService.listPublic() }),
        }),
        defineRoute({
            method: 'POST',
            path: '/users',
            schema: { body: CreateUserSchema },
            handler: async (ctx) => {
                const user = await userService.create(ctx.body.name, ctx.body.email);
                if (!user) return ctx.raw.json({ error: 'Email already registered' }, 409);
                return { created: user };
            },
        }),
    ];
}
