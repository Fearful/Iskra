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
