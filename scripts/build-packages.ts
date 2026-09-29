/**
 * Builds every `@iskra-bun/*` package to `dist/` (via each package's tsup script).
 *
 * Order matters: `web-kit` pulls in several sibling kits from its integration
 * features, so its `.d.ts` generation needs those siblings' declarations to be
 * resolvable. We build everything else first, then `web-kit`. The rest only
 * depend on `core`, which they resolve from source, so their order is irrelevant,
 * except for the kits that plug into web-kit (ldap-kit's gate): they come after
 * it, since web-kit's `.d.ts` build fails when a sibling's `dist/` that imports
 * web-kit already exists.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const WEB_KIT = 'web-kit';

const packages = readdirSync('packages', { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

/** Whether a package imports web-kit (a peer or dev dependency, as a gate or a feature). */
function usesWebKit(pkg: string): boolean {
    const manifest = JSON.parse(readFileSync(`packages/${pkg}/package.json`, 'utf8')) as Record<
        string,
        Record<string, string> | undefined
    >;
    return ['dependencies', 'peerDependencies', 'devDependencies'].some(
        (field) => manifest[field]?.['@iskra-bun/web-kit'] !== undefined,
    );
}

const after = packages.filter((p) => p !== WEB_KIT && usesWebKit(p));
const ordered = [...packages.filter((p) => p !== WEB_KIT && !after.includes(p)), WEB_KIT, ...after];

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
