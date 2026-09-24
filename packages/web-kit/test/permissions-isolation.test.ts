import { describe, it, expect } from "bun:test";
import { Kernel } from "../src/kernel";
import { PermissionsFeature, requirePermission } from "../src/features/permissions";

/** Minimal stand-in for AuthFeature: the user id comes from a header. */
class HeaderAuthFeature {
    name = "auth";
    async initialize(kernel: Kernel) {
        kernel.getApp().use("*", async (c, next) => {
            const id = c.req.header("x-user");
            if (id) c.set("user", { id } as any);
            await next();
        });
    }
}

describe("PermissionsFeature isolation between users", () => {
    it("does not leak role permissions through an array shared by the loader", async () => {
        // Regression: role permissions were pushed into the array returned by
        // loadPermissions(); a loader returning a shared/cached array handed the
        // admin's "*" to every later user.
        const shared = ["read:own"];
        const kernel = new Kernel();
        kernel.registerFeature(new HeaderAuthFeature() as any);
        kernel.registerFeature(
            new PermissionsFeature({
                loadPermissions: async () => shared,
                loadRoles: async (id) => (id === "root" ? ["admin"] : ["user"]),
                cachePermissions: false,
            }),
        );
        await kernel.initialize();
        const app = kernel.getApp();
        app.get("/danger", requirePermission("delete:everything"), (c) => c.text("ok"));

        expect((await app.request("/danger", { headers: { "x-user": "root" } })).status).toBe(200);
        expect((await app.request("/danger", { headers: { "x-user": "alice" } })).status).toBe(403);
        expect(shared).toEqual(["read:own"]);
    });
});
