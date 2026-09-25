import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// One Bun version for the whole toolchain: .bun-version drives local installs,
// CI (setup-bun reads it) and every Docker image. A stray pin compiles or
// installs with a different Bun than the one the suite ran on.
const ROOT = join(import.meta.dir, '..');
const BUN_VERSION = readFileSync(join(ROOT, '.bun-version'), 'utf8').trim();
// .claude: local agent worktrees (gitignored), with copies of the repository.
const SKIP = new Set(['node_modules', '.git', 'dist', 'target', '.claude']);

function walk(dir: string, match: (name: string) => boolean): string[] {
    return readdirSync(dir).flatMap((name) => {
        if (SKIP.has(name)) return [];
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return walk(path, match);
        return match(name) ? [path] : [];
    });
}

describe('toolchain pins', () => {
    it('every oven/bun image uses the version in .bun-version', () => {
        const dockerfiles = walk(ROOT, (name) => name === 'Dockerfile' || name.startsWith('Dockerfile.'));
        const images = dockerfiles.flatMap((file) =>
            [...readFileSync(file, 'utf8').matchAll(/^FROM\s+oven\/bun:(\S+)/gm)].map((m) => ({
                file: relative(ROOT, file),
                tag: m[1],
            })),
        );
        expect(images.length).toBeGreaterThan(10);
        expect(images.filter((i) => i.tag !== BUN_VERSION)).toEqual([]);
    });

    it('every other base image is a fixed release, and the app user cannot overwrite its code', () => {
        const dockerfiles = walk(ROOT, (name) => name === 'Dockerfile' || name.startsWith('Dockerfile.'));
        // `:latest`, a bare variant (`nginx:alpine`) or no tag: any rebuild
        // could move to another release.
        const floating = dockerfiles.flatMap((file) => {
            const text = readFileSync(file, 'utf8');
            const stages = new Set([...text.matchAll(/^FROM\s+\S+\s+AS\s+(\S+)/gim)].map((m) => m[1].toLowerCase()));
            return [...text.matchAll(/^FROM\s+(\S+)/gim)]
                .map((m) => m[1])
                .filter((image) => !stages.has(image.toLowerCase()) && image !== 'scratch' && !/:\d/.test(image))
                .map((image) => `${relative(ROOT, file)}: ${image}`);
        });
        expect(floating).toEqual([]);

        // Copied with --chown to the user the app runs as, a compromise could
        // replace the binary or scripts and persist across restarts.
        const ownedByApp = dockerfiles.flatMap((file) =>
            readFileSync(file, 'utf8')
                .split('\n')
                .filter((line) => /^COPY\b.*--chown=1001/.test(line))
                .map((line) => `${relative(ROOT, file)}: ${line.trim()}`),
        );
        expect(ownedByApp).toEqual([]);
    });

    it('workflows read .bun-version instead of pinning their own Bun', () => {
        const workflows = walk(join(ROOT, '.github', 'workflows'), (name) => name.endsWith('.yml'));
        const pinned = workflows.filter((file) => /^\s*bun-version:/m.test(readFileSync(file, 'utf8')));
        expect(pinned.map((f) => relative(ROOT, f))).toEqual([]);
    });

    it('declares the supported runtime in engines', () => {
        // The suite only runs on the pinned Bun, so that is what the packages
        // promise. create-iskra is a Node-compatible CLI (npm create iskra).
        const [major, minor] = BUN_VERSION.split('.');
        const bunRange = `>=${major}.${minor}.0`;
        const manifests = [
            join(ROOT, 'package.json'),
            ...readdirSync(join(ROOT, 'packages')).map((d) => join(ROOT, 'packages', d, 'package.json')),
        ];
        const wrong = manifests.flatMap((file) => {
            const manifest = JSON.parse(readFileSync(file, 'utf8'));
            if (manifest.private && file !== join(ROOT, 'package.json')) return [];
            const expected = manifest.name === 'create-iskra' ? { node: '>=18' } : { bun: bunRange };
            return JSON.stringify(manifest.engines) === JSON.stringify(expected)
                ? []
                : [`${relative(ROOT, file)}: ${JSON.stringify(manifest.engines)}`];
        });
        expect(wrong).toEqual([]);
    });

    it('publishes every package publicly with provenance', () => {
        const wrong = readdirSync(join(ROOT, 'packages')).flatMap((dir) => {
            const manifest = JSON.parse(readFileSync(join(ROOT, 'packages', dir, 'package.json'), 'utf8'));
            if (manifest.private) return [];
            const { access, provenance } = manifest.publishConfig ?? {};
            const repo = manifest.repository ?? {};
            // npm rejects a provenance publish whose repository does not match the source repo.
            const ok =
                access === 'public' &&
                provenance === true &&
                repo.url === 'git+https://github.com/fearful/iskra.git' &&
                repo.directory === `packages/${dir}`;
            return ok ? [] : [manifest.name];
        });
        expect(wrong).toEqual([]);
    });

    it('commits text lockfiles only', () => {
        expect(walk(ROOT, (name) => name === 'bun.lockb').map((f) => relative(ROOT, f))).toEqual([]);
    });
});
