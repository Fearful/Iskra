/**
 * Rewrites `workspace:` dependency ranges in every `packages/*` manifest to
 * real semver ranges, right before `changeset publish`.
 *
 * Changesets publishes with `npm publish` unless the repo uses pnpm, and npm
 * does not understand the `workspace:` protocol: it would ship
 * `"@iskra-bun/core": "workspace:*"` verbatim and every consumer install would
 * fail with EUNSUPPORTEDPROTOCOL. The rewrite follows the same rules as
 * `bun publish` / `pnpm publish`:
 *
 *   workspace:*        -> 1.2.3   (exact)
 *   workspace:^        -> ^1.2.3
 *   workspace:~        -> ~1.2.3
 *   workspace:<range>  -> <range>
 *
 * It edits the manifests in place, so it is meant for the disposable CI
 * checkout used by release.yml — do not commit the result.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DEP_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies'] as const;

type Manifest = { name?: string; version?: string } & Partial<
    Record<(typeof DEP_FIELDS)[number], Record<string, string>>
>;

export function resolveWorkspaceRange(spec: string, version: string): string {
    const range = spec.slice('workspace:'.length);
    if (range === '*' || range === '') return version;
    if (range === '^' || range === '~') return `${range}${version}`;
    return range;
}

/** Returns a copy of `manifest` with every `workspace:` range resolved against `versions`. */
export function pinManifest(manifest: Manifest, versions: Map<string, string>): Manifest {
    const pinned: Manifest = { ...manifest };
    for (const field of DEP_FIELDS) {
        const deps = manifest[field];
        if (!deps) continue;
        pinned[field] = Object.fromEntries(
            Object.entries(deps).map(([name, spec]) => {
                if (!spec.startsWith('workspace:')) return [name, spec];
                const version = versions.get(name);
                if (!version) {
                    throw new Error(
                        `${manifest.name}: ${field}.${name} uses "${spec}" but no workspace package named ${name} exists`,
                    );
                }
                return [name, resolveWorkspaceRange(spec, version)];
            }),
        );
    }
    return pinned;
}

function main() {
    const dirs = readdirSync('packages', { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(join('packages', e.name, 'package.json')))
        .map((e) => join('packages', e.name, 'package.json'));

    const manifests = dirs.map((path) => ({ path, raw: readFileSync(path, 'utf8') }));
    const versions = new Map<string, string>();
    for (const { raw } of manifests) {
        const { name, version } = JSON.parse(raw) as Manifest;
        if (name && version) versions.set(name, version);
    }

    let changed = 0;
    for (const { path, raw } of manifests) {
        const manifest = JSON.parse(raw) as Manifest;
        const pinned = pinManifest(manifest, versions);
        const out = JSON.stringify(pinned, null, 4) + '\n';
        if (out !== JSON.stringify(manifest, null, 4) + '\n') {
            writeFileSync(path, out);
            changed++;
            process.stdout.write(`pinned workspace deps in ${path}\n`);
        }
    }
    process.stdout.write(`✓ ${changed} manifest(s) rewritten\n`);
}

if (import.meta.main) main();
