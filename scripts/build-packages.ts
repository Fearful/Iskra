/**
 * Builds every `@iskra-bun/*` package to `dist/` (via each package's tsup script).
 *
 * Order matters: `web-kit` pulls in several sibling kits from its integration
 * features, so its `.d.ts` generation needs those siblings' declarations to be
 * resolvable. We build everything else first, then `web-kit` last. The rest only
 * depend on `core`, which they resolve from source, so their order is irrelevant.
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const LAST = 'web-kit';

const packages = readdirSync('packages', { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

const ordered = [...packages.filter((p) => p !== LAST), ...packages.filter((p) => p === LAST)];

for (const pkg of ordered) {
    process.stdout.write(`\n▶ building @iskra-bun/${pkg}\n`);
    const result = spawnSync('bun', ['run', 'build'], {
        cwd: `packages/${pkg}`,
        stdio: 'inherit',
    });
    if (result.status !== 0) {
        process.stderr.write(`\n✘ build failed for @iskra-bun/${pkg}\n`);
        process.exit(result.status ?? 1);
    }
}

process.stdout.write(`\n✓ built ${ordered.length} packages\n`);
