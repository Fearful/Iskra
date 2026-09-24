import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * The semver range that bundled `@iskra-bun/*` workspace dependencies are
 * rewritten to when a template is scaffolded into a standalone project. The
 * template `package.json` files use `workspace:*` (valid only inside the
 * monorepo); a generated project needs a real, installable range.
 */
export const WORKSPACE_REPLACEMENT_RANGE = '^0.1.0';

/** Directories that must never be copied from a template into a new project. */
export const EXCLUDED_ENTRIES: readonly string[] = ['node_modules', 'dist', '.git'];

export interface ScaffoldOptions {
    /** Template directory name, e.g. `starter-app`. */
    readonly template: string;
    /** Absolute (or cwd-relative) path of the directory to create. */
    readonly targetDir: string;
    /** Name written into the generated `package.json`. */
    readonly projectName: string;
    /** Absolute path of the directory holding the bundled templates. */
    readonly templatesRoot: string;
}

export interface ScaffoldResult {
    readonly targetDir: string;
    readonly projectName: string;
    readonly template: string;
    /** Number of `@iskra-bun/*` workspace deps rewritten to a real range. */
    readonly rewrittenDeps: number;
}

/**
 * Returns the bundled template names (immediate sub-directories of
 * `templatesRoot`), sorted alphabetically.
 */
export function listTemplates(templatesRoot: string): readonly string[] {
    if (!existsSync(templatesRoot)) return [];
    return readdirSync(templatesRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
}

/**
 * Returns true when `dir` does not exist, or exists but contains no entries.
 * A non-empty existing directory is refused by `scaffold` to avoid clobbering.
 */
export function isEmptyDir(dir: string): boolean {
    if (!existsSync(dir)) return true;
    return readdirSync(dir).length === 0;
}

/**
 * Rewrites a parsed `package.json` object for a standalone project: sets the
 * package name and replaces every `@iskra-bun/* : workspace:*` dependency with
 * a real semver range. Returns a NEW object (no mutation of the input) plus the
 * count of rewritten dependencies.
 */
export function rewritePackageJson(
    pkg: Record<string, unknown>,
    projectName: string,
    range = WORKSPACE_REPLACEMENT_RANGE,
): { readonly pkg: Record<string, unknown>; readonly rewrittenDeps: number } {
    let rewrittenDeps = 0;

    const rewriteDepGroup = (group: unknown): Record<string, string> | undefined => {
        if (group === null || typeof group !== 'object') return undefined;
        const source = group as Record<string, string>;
        const next: Record<string, string> = {};
        for (const [name, version] of Object.entries(source)) {
            if (name.startsWith('@iskra-bun/') && version.startsWith('workspace:')) {
                next[name] = range;
                rewrittenDeps += 1;
            } else {
                next[name] = version;
            }
        }
        return next;
    };

    const next: Record<string, unknown> = { ...pkg, name: projectName };

    for (const group of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
        if (group in next) {
            next[group] = rewriteDepGroup(next[group]);
        }
    }

    return { pkg: next, rewrittenDeps };
}

function copyTemplateTree(templateDir: string, targetDir: string): void {
    cpSync(templateDir, targetDir, {
        recursive: true,
        filter: (source) => {
            const name = basename(source);
            return !EXCLUDED_ENTRIES.includes(name);
        },
    });
}

function rewriteTargetPackageJson(targetDir: string, projectName: string): number {
    const packageJsonPath = join(targetDir, 'package.json');
    if (!existsSync(packageJsonPath)) return 0;

    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
    } catch (error) {
        throw new Error(
            `El package.json del template no es JSON valido: ${(error as Error).message}`,
        );
    }

    const { pkg, rewrittenDeps } = rewritePackageJson(parsed, projectName);
    writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 4)}\n`, 'utf8');
    return rewrittenDeps;
}

/**
 * Copies a bundled template into `targetDir` and rewrites its `package.json`
 * for standalone use. Pure-ish: the only side effects are filesystem writes
 * under `targetDir`. Throws (never half-writes a known-bad state) when:
 *  - the template does not exist,
 *  - the target exists and is non-empty.
 */
export function scaffold(options: ScaffoldOptions): ScaffoldResult {
    const { template, targetDir, projectName, templatesRoot } = options;

    if (!projectName.trim()) {
        throw new Error('El nombre del proyecto no puede estar vacio.');
    }

    const templateDir = join(templatesRoot, template);
    if (!existsSync(templateDir) || !statSync(templateDir).isDirectory()) {
        const available = listTemplates(templatesRoot).join(', ') || '(ninguno)';
        throw new Error(
            `El template "${template}" no existe. Templates disponibles: ${available}.`,
        );
    }

    if (!isEmptyDir(targetDir)) {
        throw new Error(
            `El directorio destino "${targetDir}" ya existe y no esta vacio. ` +
                'Elegi un directorio nuevo o vacio.',
        );
    }

    mkdirSync(targetDir, { recursive: true });
    copyTemplateTree(templateDir, targetDir);
    const rewrittenDeps = rewriteTargetPackageJson(targetDir, projectName);

    return { targetDir, projectName, template, rewrittenDeps };
}
