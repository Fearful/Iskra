import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// drizzle-kit is a devDependency (a CLI). Bun loads db-kit from src/ (the
// `bun` export condition), so a runtime import of it anywhere in src/ made
// `import "@iskra-bun/db-kit"` fail wherever drizzle-kit was not installed
// (e.g. `bun install --production`). Type-only imports are fine.
describe("db-kit runtime imports", () => {
    it("never imports drizzle-kit at runtime", () => {
        const src = join(import.meta.dir, "../src");
        const offenders = readdirSync(src)
            .filter((f) => f.endsWith(".ts"))
            .filter((f) => /^\s*import\s+(?!type\b)[^;]*from\s+['"]drizzle-kit['"]/m.test(readFileSync(join(src, f), "utf8")));
        expect(offenders).toEqual([]);
    });
});
