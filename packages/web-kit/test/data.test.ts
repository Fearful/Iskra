import { describe, expect, it } from "bun:test";
import { Kernel } from "../src/kernel";
import { DbFeature } from "../src/features/db";
import { CacheFeature } from "../src/features/cache";

describe("Data Features", () => {
    it("should init DB with sqlite memory", async () => {
        const kernel = new Kernel();
        const db = new DbFeature({
            adapter: "sqlite",
            connection: { database: ":memory:" }
        });

        kernel.registerFeature(db);
        await kernel.initialize();

        const app = kernel.getApp();
        expect(app).toBeDefined();
        // Check if context has db
        // ... requires middleware execution context, hard to mock without full request

        expect(db.db).toBeDefined();

        await kernel.shutdown(); // DB feature shutdown handles close
    });

    it("should init Cache with memory", async () => {
        const kernel = new Kernel();
        const cache = new CacheFeature({ adapter: "memory", secret: "foo" });

        kernel.registerFeature(cache);
        await kernel.initialize();

        // Test memory adapter directly
        const client = (cache as any).client;
        await client.set("foo", "bar");
        const val = await client.get("foo");
        expect(val).toBe("bar");

        await kernel.shutdown();
    });
});
