/**
 * Typechecks every template workspace with its own tsconfig (the root
 * tsconfig covers the packages only). Templates are what users start from, so
 * a type error there is a broken starting point.
 *
 *   bun scripts/typecheck-templates.ts
 */
/* eslint-disable no-console -- a CLI script: its report goes to stdout/stderr. */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['templates', 'templates/forms-app/services', 'templates/forms-app/packages'];
const dirs = roots.flatMap((root) =>
    readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => join(root, e.name))
        .filter((dir) => existsSync(join(dir, 'tsconfig.json'))),
);

// plugin-starter compiles with NodeNext and no `source` condition (it emits
// what a published plugin ships), so it resolves @iskra-bun/core through its
// dist types. Build core first on a clean checkout.
if (!existsSync(join('packages', 'core', 'dist', 'index.d.ts'))) {
    console.log('Building @iskra-bun/core (plugin-starter typechecks against its dist)...');
    const build = spawnSync('bun', ['run', 'build'], { cwd: join('packages', 'core'), stdio: 'inherit' });
    if (build.status !== 0) {
        console.error('✘ could not build packages/core');
        process.exit(1);
    }
}

const tsc = join(process.cwd(), 'node_modules', '.bin', 'tsc');
const failed: string[] = [];
for (const dir of dirs) {
    const res = spawnSync(tsc, ['--noEmit', '-p', '.'], { cwd: dir, encoding: 'utf8' });
    if (res.status === 0) continue;
    failed.push(dir);
    console.error(`\n✘ ${dir}\n${(res.stdout || res.stderr).trim()}`);
}

if (failed.length) {
    console.error(`\n${failed.length} of ${dirs.length} template(s) have type errors`);
    process.exit(1);
}
console.log(`✓ ${dirs.length} templates typecheck`);
