import { describe, expect, test } from "bun:test";
import { Kernel } from "../src/kernel";
import { CacheFeature } from "../src/features/cache";
import type { DbFeature } from "../src/features/db";
import type { StorageFeature } from "../src/features/storage";
import type { Feature } from "../src/types";

type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

class AuditFeature implements Feature {
    name = "audit";
    entries: string[] = [];
    async initialize() {}
}

// How an app adds its own feature to the registry.
declare module "../src/feature-registry" {
    interface FeatureRegistry {
        audit: AuditFeature;
    }
}

describe("FeatureRegistry", () => {
    test("built-in names return their feature's type, no cast needed", async () => {
        const kernel = new Kernel({ logger: false });
        kernel.registerFeature(new CacheFeature({ adapter: "memory" }));
        await kernel.initialize();

        const cache = kernel.getFeature("cache");
        type _cache = Expect<Equal<typeof cache, CacheFeature | undefined>>;
        const storage = kernel.getFeature("storage");
        type _storage = Expect<Equal<typeof storage, StorageFeature | undefined>>;
        const db = kernel.getFeature("db");
        type _db = Expect<Equal<typeof db, DbFeature<Record<string, unknown>> | undefined>>;
        const _assert: [_cache, _storage, _db] = [true, true, true];

        // The typed client is usable directly (health, session and rate-limit do this).
        await cache!.client.set("k", "v");
        expect(await cache!.client.get("k")).toBe("v");
        expect(_assert).toEqual([true, true, true]);
        await kernel.shutdown();
    });

    test("a name added by declaration merging is typed too", async () => {
        const kernel = new Kernel({ logger: false });
        kernel.registerFeature(new AuditFeature());
        await kernel.initialize();
        const audit = kernel.getFeature("audit");
        type _audit = Expect<Equal<typeof audit, AuditFeature | undefined>>;
        const _assert: _audit = true;
        audit!.entries.push("seen");
        expect(audit!.entries).toEqual(["seen"]);
        expect(_assert).toBe(true);
    });

    test("any other name still takes the type as a parameter, as before", () => {
        const kernel = new Kernel({ logger: false });
        const other = kernel.getFeature<AuditFeature>("not-registered");
        type _other = Expect<Equal<typeof other, AuditFeature | undefined>>;
        const untyped = kernel.getFeature("not-registered");
        type _untyped = Expect<Equal<typeof untyped, Feature | undefined>>;
        const _assert: [_other, _untyped] = [true, true];
        expect(other).toBeUndefined();
        expect(_assert).toEqual([true, true]);
    });
});
