import { QueryInputError } from '@iskra-bun/db-oracle';
import { defineRoute } from '@iskra-bun/web-kit';
import { z } from 'zod';
import type { OracleUserService } from '../../domain/oracle-user.service';
import type { UserService } from '../../domain/user.service';

/** POST /users body. Without a schema ctx.body was undefined and every POST failed with 500. */
export const CreateUserSchema = z.object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().email().max(254),
});

/** GET /oracle/users query string: all optional strings, bounded. */
export const OracleUsersQuery = z.object({
    q: z.string().max(100).optional(),
    sort: z.string().max(50).optional(),
    page: z.string().max(10).optional(),
    pageSize: z.string().max(10).optional(),
});

export function createRouter(userService: UserService, oracleUsers?: OracleUserService) {
    const routes = [
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
    if (!oracleUsers) return routes;
    return [
        ...routes,
        defineRoute({
            method: 'GET',
            path: '/oracle/users',
            schema: { query: OracleUsersQuery },
            // ?q=ana&sort=-name&page=2&pageSize=20 → { items, total, page, pageSize, pages }
            handler: async (ctx) => {
                if (!oracleUsers.available) return ctx.raw.json({ error: 'Oracle is not configured' }, 503);
                try {
                    return await oracleUsers.list(ctx.query);
                } catch (error) {
                    if (error instanceof QueryInputError) return ctx.raw.json({ error: error.message }, 400);
                    throw error;
                }
            },
        }),
    ];
}
