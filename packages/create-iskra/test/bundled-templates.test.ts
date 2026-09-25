import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { scaffold } from '../src/scaffold.ts';
import { ISKRA_VERSIONS } from '../src/versions.ts';
import { BUNDLED_TEMPLATES, listFiles, planSync } from '../scripts/sync.ts';

const templatesRoot = join(import.meta.dir, '..', 'templates');
const outRoot = mkdtempSync(join(tmpdir(), 'create-iskra-bundled-'));

afterAll(() => rmSync(outRoot, { recursive: true, force: true }));

function tsFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : tsFiles(path);
        return entry.name.endsWith('.ts') ? [path] : [];
    });
}

/** Value (non-type) named imports from `@iskra-bun/*` packages in a source file. */
function iskraValueImports(source: string): { pkg: string; names: string[] }[] {
    const imports: { pkg: string; names: string[] }[] = [];
    for (const match of source.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"](@iskra-bun\/[^'"]+)['"]/g)) {
        if (match[1]) continue;
        const names = match[2]
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s && !s.startsWith('type '))
            .map((s) => s.split(/\s+as\s+/)[0].trim());
        imports.push({ pkg: match[3], names });
    }
    return imports;
}

describe('bundled templates', () => {
    test('are in sync with the monorepo templates and package versions', () => {
        const drift = planSync().map((d) => `${d.kind} ${relative(join(import.meta.dir, '..'), d.path)}`);
        // If this fails, run `bun run scripts/sync.ts` in packages/create-iskra.
        expect(drift).toEqual([]);
    });

    for (const template of BUNDLED_TEMPLATES) {
        test(`${template}: scaffolds with installable @iskra-bun ranges`, () => {
            const targetDir = join(outRoot, template);
            scaffold({ template, targetDir, projectName: `my-${template}`, templatesRoot });

            const raw = readFileSync(join(targetDir, 'package.json'), 'utf8');
            expect(raw).not.toContain('workspace:');

            const pkg = JSON.parse(raw);
            for (const [name, range] of Object.entries<string>(pkg.dependencies ?? {})) {
                if (name.startsWith('@iskra-bun/')) expect(range).toBe(`^${ISKRA_VERSIONS[name]}`);
            }
        });

        test(`${template}: only imports names the @iskra-bun packages actually export`, async () => {
            // Regression: starter-app shipped `import { WebServer }` after web-kit renamed it,
            // so every project scaffolded from the default template crashed on start.
            const missing: string[] = [];
            for (const file of tsFiles(join(templatesRoot, template))) {
                for (const { pkg, names } of iskraValueImports(readFileSync(file, 'utf8'))) {
                    const mod = await import(pkg);
                    for (const name of names) {
                        if (!(name in mod)) missing.push(`${relative(templatesRoot, file)}: ${name} from ${pkg}`);
                    }
                }
            }
            expect(missing).toEqual([]);
        });
    }
});

describe('sync.ts listFiles', () => {
    test('refuses a symlink instead of copying what it points to into the package', () => {
        const dir = mkdtempSync(join(outRoot, 'symlink-'));
        mkdirSync(join(dir, 'src'));
        writeFileSync(join(dir, 'src', 'main.ts'), 'export {};');
        expect(listFiles(dir)).toEqual([join('src', 'main.ts')]);

        symlinkSync('/proc/self/environ', join(dir, 'NOTICE'));
        expect(() => listFiles(dir)).toThrow('NOTICE');
    });
});
