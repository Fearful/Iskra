import type { Feature, PermissionsConfig, Role } from "../types";
import type { Kernel } from "../kernel";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";

declare module "hono" {
    interface ContextVariableMap {
        userPermissions: string[];
        checkPermission: (permission: string) => boolean;
        hasRole: (role: string) => boolean;
        hasAnyRole: (...roles: string[]) => boolean;
        hasAllRoles: (...roles: string[]) => boolean;
    }
}

const DEFAULT_ROLES: Record<string, Role> = {
    admin: { name: "admin", permissions: ["*"], description: "Full access" },
    user: { name: "user", permissions: ["read:own", "write:own"], description: "User access" },
    guest: { name: "guest", permissions: ["read:public"], description: "Guest access" }
};

export class PermissionsFeature implements Feature {
    name = "permissions";
    dependencies = ["auth"];
    private config: Required<PermissionsConfig>;
    private roles: Map<string, Role> = new Map();

    constructor(config: PermissionsConfig = {}) {
        this.config = {
            loadPermissions: config.loadPermissions || (async () => ["read:own"]),
            loadRoles: config.loadRoles || (async () => ["user"]),
            anonymousPermissions: config.anonymousPermissions || ["read:public"],
            enableRBAC: config.enableRBAC ?? true,
            cachePermissions: config.cachePermissions ?? true,
            cacheTTL: config.cacheTTL || 3600
        };
        Object.values(DEFAULT_ROLES).forEach(r => this.roles.set(r.name, r));
    }

    async initialize(kernel: Kernel): Promise<void> {
        const app = kernel.getApp();
        app.use("*", async (c: Context, next: Next) => {
            await this.permissionsMiddleware(c, next, kernel);
        });
        console.log("✅ Permissions feature initialized");
    }

    private async permissionsMiddleware(c: Context, next: Next, _kernel: Kernel) {
        const user = c.get("user") || (c.get("session") as any)?.user;
        const userId = user?.id;

        let permissions: string[] = [];
        let roles: string[] = [];

        if (userId) {
            if (this.config.cachePermissions) {
                const cache = c.get("cache");
                if (cache) {
                    const cached = await cache.get(`permissions:${userId}`);
                    if (cached) {
                        permissions = cached.permissions || [];
                        roles = cached.roles || [];
                    }
                }
            }

            if (permissions.length === 0) {
                permissions = await this.config.loadPermissions(userId);
                if (this.config.enableRBAC) {
                    roles = await this.config.loadRoles(userId);
                    for (const rName of roles) {
                        const r = this.roles.get(rName);
                        if (r) permissions.push(...r.permissions);
                    }
                }

                if (this.config.cachePermissions) {
                    const cache = c.get("cache");
                    if (cache) {
                        // Assume cache set exists and supports object storage (json stringify maybe required depending on cache impl)
                        // Simple cache might require string
                        await cache.set(`permissions:${userId}`, { permissions, roles }, this.config.cacheTTL);
                    }
                }
            }
        } else {
            permissions = this.config.anonymousPermissions;
        }

        permissions = [...new Set(permissions)];

        c.set("userPermissions", permissions);
        c.set("checkPermission", (p: string) => this.checkPermission(permissions, p));
        c.set("hasRole", (r: string) => roles.includes(r));
        c.set("hasAnyRole", (...rs: string[]) => rs.some(r => roles.includes(r)));
        c.set("hasAllRoles", (...rs: string[]) => rs.every(r => roles.includes(r)));

        await next();
    }

    private checkPermission(userPerms: string[], required: string): boolean {
        if (userPerms.includes("*")) return true;
        if (userPerms.includes(required)) return true;

        const parts = required.split(":");
        for (let i = parts.length - 1; i > 0; i--) {
            const pattern = parts.slice(0, i).join(":") + ":*";
            if (userPerms.includes(pattern)) return true;
        }
        return false;
    }
}

export function requirePermission(permission: string) {
    return async (c: Context, next: Next) => {
        const check = c.get("checkPermission");
        if (!check || !check(permission)) throw new HTTPException(403, { message: `Missing permission: ${permission}` });
        await next();
    };
}

export function requireRole(role: string) {
    return async (c: Context, next: Next) => {
        const check = c.get("hasRole");
        if (!check || !check(role)) throw new HTTPException(403, { message: `Missing role: ${role}` });
        await next();
    };
}
