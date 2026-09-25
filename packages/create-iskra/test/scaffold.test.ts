import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    isEmptyDir,
    listTemplates,
    packageNameFor,
    rewritePackageJson,
    scaffold,
    workspaceRange,
} from '../src/scaffold.ts';
import { ISKRA_VERSIONS } from '../src/versions.ts';

const range = (name: string) => `^${ISKRA_VERSIONS[name]}`;

/**
 * Builds a throwaway templates root with a single `demo` template that mimics
 * the shape of a real Iskra template (workspace deps + node_modules to skip).
 */
function makeTemplatesRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'create-iskra-templates-'));
    const demo = join(root, 'demo');
    mkdirSync(join(demo, 'src'), { recursive: true });
    mkdirSync(join(demo, 'node_modules', 'leftover'), { recursive: true });
    mkdirSync(join(demo, 'dist'), { recursive: true });

    writeFileSync(
        join(demo, 'package.json'),
        JSON.stringify(
            {
                name: 'demo',
                version: '0.1.0',
                dependencies: {
                    '@iskra-bun/core': 'workspace:*',
                    '@iskra-bun/web-kit': 'workspace:*',
                    zod: '^3.24.1',
                },
                devDependencies: {
                    '@iskra-bun/testing-kit': 'workspace:^',
                },
            },
            null,
            4,
        ),
    );
    writeFileSync(join(demo, 'src', 'main.ts'), 'console.log("hi");\n');
    writeFileSync(join(demo, 'node_modules', 'leftover', 'junk.js'), 'junk');
    writeFileSync(join(demo, 'dist', 'main.js'), 'built');
    return root;
}

describe('rewritePackageJson', () => {
    test('sets name and rewrites @iskra-bun workspace deps to a real range', () => {
        const input = {
            name: 'demo',
            dependencies: { '@iskra-bun/core': 'workspace:*', zod: '^3.0.0' },
            devDependencies: { '@iskra-bun/testing-kit': 'workspace:^' },
        };
        const versions = { '@iskra-bun/core': '0.1.1', '@iskra-bun/testing-kit': '0.3.0' };
        const { pkg, rewrittenDeps } = rewritePackageJson(input, 'my-app', versions);

        expect(pkg.name).toBe('my-app');
        expect((pkg.dependencies as Record<string, string>)['@iskra-bun/core']).toBe('^0.1.1');
        expect((pkg.dependencies as Record<string, string>)['zod']).toBe('^3.0.0');
        expect((pkg.devDependencies as Record<string, string>)['@iskra-bun/testing-kit']).toBe('^0.3.0');
        expect(rewrittenDeps).toBe(2);
    });

    test('gives each package a range on its own version, not one shared range', () => {
        // Regression: a single hardcoded `^0.1.0` excluded web-kit 0.2.x on 0.x semver.
        const input = {
            name: 'demo',
            dependencies: { '@iskra-bun/core': 'workspace:*', '@iskra-bun/web-kit': 'workspace:*' },
        };
        const { pkg } = rewritePackageJson(input, 'my-app', {
            '@iskra-bun/core': '0.1.1',
            '@iskra-bun/web-kit': '0.2.0',
        });
        expect(pkg.dependencies).toEqual({ '@iskra-bun/core': '^0.1.1', '@iskra-bun/web-kit': '^0.2.0' });
    });

    test('refuses to guess a range for an unknown @iskra-bun package', () => {
        expect(() => workspaceRange('@iskra-bun/nope', {})).toThrow(/@iskra-bun\/nope/);
    });

    test('does not mutate the input object (immutability)', () => {
        const input = { name: 'demo', dependencies: { '@iskra-bun/core': 'workspace:*' } };
        rewritePackageJson(input, 'my-app');
        expect(input.name).toBe('demo');
        expect(input.dependencies['@iskra-bun/core']).toBe('workspace:*');
    });

    test('leaves non-workspace @iskra-bun pins untouched', () => {
        const input = { name: 'x', dependencies: { '@iskra-bun/core': '^0.2.0' } };
        const { pkg, rewrittenDeps } = rewritePackageJson(input, 'y');
        expect((pkg.dependencies as Record<string, string>)['@iskra-bun/core']).toBe('^0.2.0');
        expect(rewrittenDeps).toBe(0);
    });
});

describe('listTemplates / isEmptyDir', () => {
    let templatesRoot: string;
    beforeEach(() => {
        templatesRoot = makeTemplatesRoot();
    });
    afterEach(() => {
        rmSync(templatesRoot, { recursive: true, force: true });
    });

    test('listTemplates returns bundled template directory names', () => {
        expect(listTemplates(templatesRoot)).toEqual(['demo']);
    });

    test('listTemplates returns empty for a missing root', () => {
        expect(listTemplates(join(templatesRoot, 'nope'))).toEqual([]);
    });

    test('isEmptyDir is true for missing and empty dirs, false for non-empty', () => {
        const empty = mkdtempSync(join(tmpdir(), 'create-iskra-empty-'));
        expect(isEmptyDir(join(empty, 'missing'))).toBe(true);
        expect(isEmptyDir(empty)).toBe(true);
        writeFileSync(join(empty, 'f.txt'), 'x');
        expect(isEmptyDir(empty)).toBe(false);
        rmSync(empty, { recursive: true, force: true });
    });
});

describe('scaffold', () => {
    let templatesRoot: string;
    let outRoot: string;

    beforeEach(() => {
        templatesRoot = makeTemplatesRoot();
        outRoot = mkdtempSync(join(tmpdir(), 'create-iskra-out-'));
    });
    afterEach(() => {
        rmSync(templatesRoot, { recursive: true, force: true });
        rmSync(outRoot, { recursive: true, force: true });
    });

    test('copies template files and rewrites package.json', () => {
        const targetDir = join(outRoot, 'my-app');
        const result = scaffold({
            template: 'demo',
            targetDir,
            projectName: 'my-app',
            templatesRoot,
        });

        // 2 in dependencies (core, web-kit) + 1 in devDependencies (testing-kit)
        expect(result.rewrittenDeps).toBe(3);

        // src copied
        expect(readFileSync(join(targetDir, 'src', 'main.ts'), 'utf8')).toContain('hi');

        // package.json rewritten
        const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf8'));
        expect(pkg.name).toBe('my-app');
        expect(pkg.dependencies['@iskra-bun/core']).toBe(range('@iskra-bun/core'));
        expect(pkg.dependencies['@iskra-bun/web-kit']).toBe(range('@iskra-bun/web-kit'));
        expect(pkg.dependencies['zod']).toBe('^3.24.1');
        expect(pkg.devDependencies['@iskra-bun/testing-kit']).toBe(range('@iskra-bun/testing-kit'));
    });

    test('excludes node_modules and dist from the copy', () => {
        const targetDir = join(outRoot, 'clean-app');
        scaffold({ template: 'demo', targetDir, projectName: 'clean-app', templatesRoot });
        expect(isEmptyDir(join(targetDir, 'node_modules'))).toBe(true); // missing => true
        expect(isEmptyDir(join(targetDir, 'dist'))).toBe(true);
    });

    test('refuses a template name that is not one of the templates', () => {
        // A sibling of the templates root, reachable with "../".
        const outside = join(templatesRoot, '..', `outside-${Date.now()}`);
        mkdirSync(join(outside, 'secrets'), { recursive: true });
        writeFileSync(join(outside, 'package.json'), '{"name":"outside"}');
        try {
            const targetDir = join(outRoot, 'traversal');
            const template = join('..', outside.split(/[\\/]/).pop()!);
            expect(() => scaffold({ template, targetDir, projectName: 'traversal', templatesRoot })).toThrow(
                /no existe/,
            );
            expect(isEmptyDir(targetDir)).toBe(true);
        } finally {
            rmSync(outside, { recursive: true, force: true });
        }
    });

    test('refuses to overwrite a non-empty existing directory', () => {
        const targetDir = join(outRoot, 'occupied');
        mkdirSync(targetDir, { recursive: true });
        writeFileSync(join(targetDir, 'existing.txt'), 'do not clobber');

        expect(() => scaffold({ template: 'demo', targetDir, projectName: 'occupied', templatesRoot })).toThrow(
            /ya existe y no esta vacio/,
        );

        // existing file untouched
        expect(readFileSync(join(targetDir, 'existing.txt'), 'utf8')).toBe('do not clobber');
    });

    test('throws for an unknown template, listing available ones', () => {
        expect(() =>
            scaffold({
                template: 'ghost',
                targetDir: join(outRoot, 'x'),
                projectName: 'x',
                templatesRoot,
            }),
        ).toThrow(/ghost.*no existe.*demo/s);
    });

    test('throws for an empty project name', () => {
        expect(() =>
            scaffold({
                template: 'demo',
                targetDir: join(outRoot, 'y'),
                projectName: '   ',
                templatesRoot,
            }),
        ).toThrow(/nombre del proyecto/);
    });
});

describe('generated project basics', () => {
    test('packageNameFor derives a valid npm name from the directory', () => {
        expect(packageNameFor('my-app/')).toBe('my-app');
        expect(packageNameFor('./apps/My Cool App')).toBe('my-cool-app');
        expect(packageNameFor('_private')).toBe('private');
        // "." is the current directory: its own name.
        expect(packageNameFor('.')).toBe(packageNameFor(process.cwd()));
        expect(packageNameFor('/')).toBe('iskra-app');
    });

    test('scaffold writes a .gitignore (npm drops them from published packages)', () => {
        const root = mkdtempSync(join(tmpdir(), 'create-iskra-gitignore-'));
        try {
            const templatesRoot = join(root, 'templates');
            mkdirSync(join(templatesRoot, 'mini'), { recursive: true });
            writeFileSync(join(templatesRoot, 'mini', 'package.json'), '{"name":"mini"}');
            const targetDir = join(root, 'out');
            scaffold({ template: 'mini', targetDir, projectName: 'out', templatesRoot });
            const gitignore = readFileSync(join(targetDir, '.gitignore'), 'utf8');
            expect(gitignore).toContain('node_modules/');
            expect(gitignore).toContain('.env');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
