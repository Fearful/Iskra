import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// The site sources are the only copy of the docs: docs/ held a Spanish copy
// that drifted from them. These checks keep it that way.
const ROOT = join(import.meta.dir, '..');
const CONTENT = join(ROOT, 'website', 'src', 'content', 'docs');
const SITE = 'https://iskra-docs.fly.dev/';
const SKIP = new Set(['node_modules', '.git', 'dist', 'target', 'website']);

function walk(dir: string, match: (name: string) => boolean): string[] {
    return readdirSync(dir).flatMap((name) => {
        if (SKIP.has(name)) return [];
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return walk(path, match);
        return match(name) ? [path] : [];
    });
}

function pages(dir: string, base = dir): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name === 'es' && dir === CONTENT ? [] : pages(path, base);
        return /\.mdx?$/.test(name) ? [relative(base, path).replace(/\.mdx?$/, '')] : [];
    });
}

function pageExists(slug: string): boolean {
    const path = join(CONTENT, slug.replace(/\/$/, '') || 'index');
    return ['.md', '.mdx', '/index.md', '/index.mdx'].some((ext) => existsSync(path + ext));
}

describe('documentation', () => {
    it('has no copy outside the site sources', () => {
        expect(readdirSync(join(ROOT, 'docs'))).toEqual(['README.md']);
    });

    it('translates every page', () => {
        const en = pages(CONTENT).sort();
        const es = pages(join(CONTENT, 'es')).sort();
        expect(es).toEqual(en);
    });

    it('links only to pages that exist', () => {
        const files = walk(ROOT, (name) => name.endsWith('.md') && !name.startsWith('CHANGELOG'));
        const broken = files.flatMap((file) => {
            const text = readFileSync(file, 'utf8');
            const stale = [...text.matchAll(/\]\((?:\.\.\/)*\.?\/?docs\/(?!README)[\w-]+\.md/g)].map((m) => m[0]);
            const missing = [...text.matchAll(/https:\/\/iskra-docs\.fly\.dev\/([\w/-]*)/g)]
                .map((m) => m[1])
                .filter((slug) => !pageExists(slug))
                .map((slug) => SITE + slug);
            return [...stale, ...missing].map((link) => `${relative(ROOT, file)}: ${link}`);
        });
        expect(broken).toEqual([]);
    });

    it('imports only names the packages export', async () => {
        // The Getting Started tutorial imported HealthFeature months after it
        // became HealthCheckFeature: a new user's first run failed.
        // Upgrade guides show the code from before on purpose. CONTENT sits
        // under 'website', which walk() skips from ROOT, so it is walked on its own.
        const files = [
            ...walk(CONTENT, (name) => /\.mdx?$/.test(name)).filter((f) => !/guides\/upgrading-/.test(f)),
            ...walk(ROOT, (name) => name === 'README.md' || name === 'README.es.md'),
        ];
        const importRe = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*['"](@iskra-bun\/[\w-]+|create-iskra)['"]/g;
        const modules = new Map<string, Record<string, unknown>>();
        const sources = new Map<string, string>();
        const missing: string[] = [];

        for (const file of files) {
            const text = readFileSync(file, 'utf8');
            for (const [, typeOnly, list, spec] of text.matchAll(importRe)) {
                if (typeOnly) continue;
                const pkg = spec === 'create-iskra' ? 'create-iskra' : spec.slice('@iskra-bun/'.length);
                if (!modules.has(spec)) modules.set(spec, await import(spec));
                const names = list
                    .split(',')
                    .map((n) => n.trim())
                    .filter((n) => n && !n.startsWith('type '))
                    .map((n) => n.split(/\s+as\s+/)[0]);
                for (const name of names) {
                    if (name in modules.get(spec)!) continue;
                    // A type or interface imported without `type`: declared in the package's src.
                    if (!sources.has(pkg)) {
                        const src = join(ROOT, 'packages', pkg, 'src');
                        const code = walk(src, (n) => n.endsWith('.ts'))
                            .map((f) => readFileSync(f, 'utf8'))
                            .join('\n');
                        sources.set(pkg, code);
                    }
                    const declared = new RegExp(`\\b(?:interface|type)\\s+${name}\\b`).test(sources.get(pkg)!);
                    if (!declared) missing.push(`${relative(ROOT, file)}: ${name} from ${spec}`);
                }
            }
        }
        expect(missing).toEqual([]);
    });
});
