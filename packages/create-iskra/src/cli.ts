import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface, type Interface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { listTemplates, packageNameFor, scaffold } from './scaffold.ts';
import { blank, error, info } from './print.ts';

const DEFAULT_TEMPLATE = 'starter-app';

/** Absolute path to the templates bundled with this published package. */
function bundledTemplatesRoot(): string {
    // `import.meta.url` points at this file inside `dist/` once built, so the
    // bundled `templates/` directory sits one level up, next to `dist/`.
    const here = dirname(fileURLToPath(import.meta.url));
    return join(here, '..', 'templates');
}

export interface ParsedArgs {
    readonly targetDir?: string;
    readonly template?: string;
    readonly yes: boolean;
    readonly help: boolean;
}

/** Parses argv (without the leading `node`/script entries). Pure. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
    let targetDir: string | undefined;
    let template: string | undefined;
    let yes = false;
    let help = false;

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--yes' || arg === '-y') {
            yes = true;
        } else if (arg === '--help' || arg === '-h') {
            help = true;
        } else if (arg === '--template' || arg === '-t') {
            template = argv[i + 1];
            i += 1;
        } else if (arg.startsWith('--template=')) {
            template = arg.slice('--template='.length);
        } else if (!arg.startsWith('-') && targetDir === undefined) {
            targetDir = arg;
        }
    }

    return { targetDir, template, yes, help };
}

function printHelp(templatesRoot: string): void {
    const templates = listTemplates(templatesRoot);
    info('create-iskra — Andamiaje de proyectos Iskra');
    blank();
    info('Uso:');
    info('  bun create iskra [directorio] [--template <nombre>] [--yes]');
    blank();
    info('Opciones:');
    info('  -t, --template <nombre>  Template a usar (default: starter-app)');
    info('  -y, --yes                Acepta los valores por defecto sin preguntar');
    info('  -h, --help               Muestra esta ayuda');
    blank();
    info(`Templates disponibles: ${templates.join(', ') || '(ninguno)'}`);
}

/**
 * Prompts for a value over the given readline interface. Returns the trimmed
 * input, or the fallback when the user submits empty input. Returns `undefined`
 * only when the prompt is cancelled (Ctrl-C / EOF), so callers can abort cleanly.
 *
 * Uses `node:readline/promises` (rather than Bun's global `prompt()`) so the
 * bin works under both Bun and Node — the latter has no global `prompt`. A
 * single shared interface is reused across prompts to avoid races on stdin.
 *
 * If stdin closes (EOF) while a prompt is pending — e.g. piped/non-interactive
 * input that runs dry — the prompt resolves to `fallback` rather than hanging.
 */
/** Sentinel resolved when the readline interface closes mid-prompt (EOF). */
const EOF = Symbol('eof');
/** Sentinel resolved on Ctrl-C at a prompt. */
const CANCEL = Symbol('cancel');

/** @internal Exported for tests. */
export async function ask(rl: Interface, question: string, fallback: string): Promise<string | undefined> {
    // Stdin already closed (an earlier prompt hit EOF) — take the default.
    // `closed` exists at runtime but is absent from these @types/node; narrow.
    if ((rl as { closed?: boolean }).closed) return fallback;
    let onClose!: () => void;
    let onSigint!: () => void;
    const closed = new Promise<typeof EOF>((resolve) => rl.once('close', (onClose = () => resolve(EOF))));
    // Without a SIGINT listener readline closed the interface on Ctrl-C, which
    // read as EOF: the defaults were taken and the project scaffolded anyway.
    const cancelled = new Promise<typeof CANCEL>((resolve) => rl.once('SIGINT', (onSigint = () => resolve(CANCEL))));
    const pending = rl.question(`${question} (${fallback}) `);
    // Left pending when the race is decided otherwise; it rejects on close.
    pending.catch(() => {});
    try {
        const answer = await Promise.race([pending, closed, cancelled]);
        if (answer === CANCEL) return undefined;
        if (answer === EOF) return fallback;
        const trimmed = answer.trim();
        return trimmed === '' ? fallback : trimmed;
    } catch {
        // Cancelled (abort) — let the caller abort cleanly.
        return undefined;
    } finally {
        rl.off('close', onClose);
        rl.off('SIGINT', onSigint);
    }
}

async function chooseTemplate(
    rl: Interface | undefined,
    requested: string | undefined,
    templatesRoot: string,
): Promise<string | undefined> {
    const available = listTemplates(templatesRoot);

    if (requested) return requested;
    if (!rl || available.length === 0) return DEFAULT_TEMPLATE;

    info('Templates disponibles:');
    for (const name of available) {
        info(`  - ${name}${name === DEFAULT_TEMPLATE ? ' (default)' : ''}`);
    }
    return ask(rl, 'Template', DEFAULT_TEMPLATE);
}

/** Runs the CLI. Returns a process exit code (0 = success). */
export async function run(argv: readonly string[]): Promise<number> {
    const templatesRoot = bundledTemplatesRoot();
    const parsed = parseArgs(argv);

    if (parsed.help) {
        printHelp(templatesRoot);
        return 0;
    }

    const interactive = !parsed.yes;
    // One shared readline interface for the whole interactive flow; created only
    // when needed and always closed before returning.
    const rl = interactive ? createInterface({ input: stdin, output: stdout }) : undefined;

    try {
        const targetDir =
            parsed.targetDir ?? (rl ? await ask(rl, 'Directorio del proyecto', 'mi-app') : 'mi-app');
        if (targetDir === undefined) {
            error('Cancelado.');
            return 1;
        }

        const template = await chooseTemplate(rl, parsed.template, templatesRoot);
        if (template === undefined) {
            error('Cancelado.');
            return 1;
        }

        const projectName = packageNameFor(targetDir);

        const result = scaffold({ template, targetDir, projectName, templatesRoot });
        printNextSteps(result.targetDir, result.template);
        return 0;
    } catch (err) {
        error(`\nError: ${(err as Error).message}`);
        return 1;
    } finally {
        rl?.close();
    }
}

function printNextSteps(targetDir: string, template: string): void {
    blank();
    info(`Proyecto creado en "${targetDir}" (template: ${template}).`);
    blank();
    info('Proximos pasos:');
    info(`  cd ${targetDir}`);
    info('  bun install');
    info('  bun start        # o "bun run dev" si el template lo define');
    blank();
    info('Feliz hacking con Iskra.');
}

/**
 * Auto-run only when this module is the program entry point (i.e. invoked as
 * the `create-iskra` bin), never when imported by tests or the barrel. Paths
 * are compared after resolving symlinks: `npm create`, `npx` and `bunx` run
 * the bin through `node_modules/.bin/create-iskra`, a link to this file, and
 * comparing that path with this module's did nothing at all.
 */
function isMainEntry(): boolean {
    const entry = process.argv[1];
    if (!entry) return false;
    try {
        return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
    } catch {
        return false;
    }
}

if (isMainEntry()) {
    run(process.argv.slice(2)).then(
        (code) => process.exit(code),
        (err) => {
            error(`\nError: ${(err as Error).message}`);
            process.exit(1);
        },
    );
}
