import type { Feature, PermissionsConfig, Role } from '../types';
import type { Kernel } from '../kernel';
import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { consoleLogger, type KernelLogger } from '../logging';

declare module 'hono' {
    interface ContextVariableMap {
        userPermissions: string[];
        checkPermission: (permission: string) => boolean;
        hasRole: (role: string) => boolean;
        hasAnyRole: (...roles: string[]) => boolean;
        hasAllRoles: (...roles: string[]) => boolean;
    }
}

const DEFAULT_ROLES: Record<string, Role> = {
    admin: { name: 'admin', permissions: ['*'], description: 'Full access' },
    user: { name: 'user', permissions: ['read:own', 'write:own'], description: 'User access' },
    guest: { name: 'guest', permissions: ['read:public'], description: 'Guest access' },
};

/** The strings of `value` when it is an array (a cached entry is not trusted blindly). */
function stringList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export class PermissionsFeature implements Feature {
    name = 'permissions';
    private log: KernelLogger = consoleLogger;
    /**
     * Its middleware reads the user (auth or session) and the cache, so those
     * features' middleware must run first whatever the registration order.
     * None is required: without them every request is anonymous.
     */
    dependencies: string[] = [];
    optionalDependencies = ['auth', 'session', 'cache'];
    private config: Required<PermissionsConfig>;
    private roles: Map<string, Role> = new Map();
    private kernel?: Kernel;

    constructor(config: PermissionsConfig = {}) {
        this.config = {
            loadPermissions: config.loadPermissions || (async () => ['read:own']),
            loadRoles: config.loadRoles || (async () => ['user']),
            anonymousPermissions: config.anonymousPermissions || ['read:public'],
            enableRBAC: config.enableRBAC ?? true,
            cachePermissions: config.cachePermissions ?? true,
            // A revoked role or permission keeps working until the cached copy
            // expires: an hour by default was far too long to wait.
            cacheTTL: config.cacheTTL || 60,
        };
        Object.values(DEFAULT_ROLES).forEach((r) => this.roles.set(r.name, r));
    }

    /**
     * Drops the cached permissions and roles of `userId`, so the next request
     * loads them again. Call it after changing them (a role revoked, a user
     * blocked): until then the cached copy applies, for up to `cacheTTL`.
     */
    async invalidate(userId: string): Promise<void> {
        await this.kernel?.getFeature('cache')?.client?.delete(`permissions:${userId}`);
    }

    async initialize(kernel: Kernel): Promise<void> {
        this.log = kernel.getLogger();
        this.kernel = kernel;
        const app = kernel.getApp();
        app.use('*', async (c: Context, next: Next) => {
            await this.permissionsMiddleware(c, next, kernel);
        });
        this.log.debug('Permissions feature initialized');
    }

    private async permissionsMiddleware(c: Context, next: Next, _kernel: Kernel) {
        // The auth feature's user, else a `user` a session holds (`{ id }`).
        const sessionUser = c.get('session')?.user;
        const user =
            c.get('user') ??
            (sessionUser && typeof sessionUser === 'object' ? (sessionUser as { id?: unknown }) : undefined);
        const userId = user?.id == null ? undefined : String(user.id);

        let permissions: string[] = [];
        let roles: string[] = [];

        if (userId) {
            if (this.config.cachePermissions) {
                const cache = c.get('cache');
                if (cache) {
                    // What this feature stored below: { permissions, roles }.
                    const cached = await cache.get(`permissions:${userId}`);
                    if (cached && typeof cached === 'object') {
                        const entry = cached as { permissions?: unknown; roles?: unknown };
                        permissions = stringList(entry.permissions);
                        roles = stringList(entry.roles);
                    }
                }
            }

            if (permissions.length === 0) {
                // Copy: role permissions are appended below, and the loader may
                // return a shared/cached array — mutating it would leak role
                // permissions (e.g. admin "*") into other users' results.
                permissions = [...(await this.config.loadPermissions(userId))];
                if (this.config.enableRBAC) {
                    roles = await this.config.loadRoles(userId);
                    for (const rName of roles) {
                        const r = this.roles.get(rName);
                        if (r) permissions.push(...r.permissions);
                    }
                }

                if (this.config.cachePermissions) {
                    const cache = c.get('cache');
                    if (cache) {
                        // Until it expires or invalidate(userId) drops it.
                        await cache.set(`permissions:${userId}`, { permissions, roles }, this.config.cacheTTL);
                    }
                }
            }
        } else {
            permissions = this.config.anonymousPermissions;
        }

        permissions = [...new Set(permissions)];

        c.set('userPermissions', permissions);
        c.set('checkPermission', (p: string) => this.checkPermission(permissions, p));
        c.set('hasRole', (r: string) => roles.includes(r));
        c.set('hasAnyRole', (...rs: string[]) => rs.some((r) => roles.includes(r)));
        c.set('hasAllRoles', (...rs: string[]) => rs.every((r) => roles.includes(r)));

        await next();
    }

    private checkPermission(userPerms: string[], required: string): boolean {
        if (userPerms.includes('*')) return true;
        if (userPerms.includes(required)) return true;

        const parts = required.split(':');
        for (let i = parts.length - 1; i > 0; i--) {
            const pattern = parts.slice(0, i).join(':') + ':*';
            if (userPerms.includes(pattern)) return true;
        }
        return false;
    }
}

export function requirePermission(permission: string) {
    return async (c: Context, next: Next) => {
        const check = c.get('checkPermission');
        if (!check || !check(permission))
            throw new HTTPException(403, { message: `Missing permission: ${permission}` });
        await next();
    };
}

export function requireRole(role: string) {
    return async (c: Context, next: Next) => {
        const check = c.get('hasRole');
        if (!check || !check(role)) throw new HTTPException(403, { message: `Missing role: ${role}` });
        await next();
    };
}
