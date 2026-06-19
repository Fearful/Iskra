import { defineConfig } from 'tsup';

// Shared build config for all @iskra-bun/* packages. Each package's `build`
// script runs `tsup --config ../../tsup.config.ts` from its own directory, so
// `entry` resolves against that package's `src/`.
//
// Workspace dependencies (@iskra-bun/*) are left external — they resolve to the
// consumer's installed copy at runtime, and their .d.ts is generated using the
// `source` export condition (see tsconfig.base.json `customConditions`), so the
// build does not require sibling packages to be built first.
export default defineConfig({
    entry: ['src/index.ts'],
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
