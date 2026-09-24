import { defineConfig } from 'tsup';

/**
 * Local build config for `create-iskra`. Unlike the shared root config (which
 * only builds `src/index.ts`), this CLI package needs a runnable `dist/cli.js`
 * bin entry, so we build both the barrel and the CLI, and inject a Node shebang
 * banner so `dist/cli.js` is directly executable.
 */
export default defineConfig({
    entry: ['src/index.ts', 'src/cli.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    // Keep each entry self-contained: the bin (`cli.js`) must own its
    // `import.meta.url` (used for the entry-point guard and to locate the
    // bundled `templates/` dir), so it can't be hoisted into a shared chunk.
    splitting: false,
    target: 'node18',
    outDir: 'dist',
    tsconfig: '../../tsconfig.base.json',
    banner: { js: '#!/usr/bin/env node' },
    // Bun runtime built-ins are provided by the runtime, not npm.
    external: [/^bun(:.*)?$/],
});
