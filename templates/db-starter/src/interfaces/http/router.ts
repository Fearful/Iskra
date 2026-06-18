import type { UserService } from '../../domain/user.service';

export function createRouter(userService: UserService) {
    return [
        {
            method: 'GET' as const,
            path: '/users',
            handler: async () => {
                const allUsers = await userService.findAll();
                return { users: allUsers };
            }
        },
        {
            method: 'POST' as const,
            path: '/users',
            handler: async (ctx: any) => {
                const { name, email } = ctx.body;
                const user = await userService.create(name, email);
                return { created: user };
            }
        }
    ];
}
