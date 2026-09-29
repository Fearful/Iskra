import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

/**
 * The package's entry points: the `source` of each subpath in its `exports`
 * (`.` → src/index.ts, `./hono` → src/hono.ts…), so adding a subpath to
 * package.json is enough to build it.
 */
function entries(): string[] {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
        exports?: Record<string, { source?: string } | string>;
    };
    const sources = Object.values(manifest.exports ?? {}).flatMap((target) =>
        typeof target === 'object' && target.source ? [target.source.replace(/^\.\//, '')] : [],
    );
    return sources.length > 0 ? sources : ['src/index.ts'];
}

// Shared build config for all @iskra-bun/* packages. Each package's `build`
// script runs `tsup --config ../../tsup.config.ts` from its own directory, so
// `entry` resolves against that package's `src/` and `package.json`.
//
// Workspace dependencies (@iskra-bun/*) are left external — they resolve to the
// consumer's installed copy at runtime, and their .d.ts is generated using the
// `source` export condition (see tsconfig.base.json `customConditions`), so the
// build does not require sibling packages to be built first.
export default defineConfig({
    entry: entries(),
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    target: 'node18',
    outDir: 'dist',
    tsconfig: '../../tsconfig.base.json',
    // Bun runtime built-ins (`bun`, `bun:sqlite`, `bun:ffi`, …) are provided by
    // the runtime, not npm — leave them external so esbuild doesn't try to
    // bundle them. (node: builtins and workspace deps are already external.)
    external: [/^bun(:.*)?$/],
});
