/**
 * Writes db/init/01-schema.sql (the forms-app tables, for Postgres'
 * /docker-entrypoint-initdb.d) from src/db/schema.ts with drizzle-kit.
 *
 *   bun run db:init-sql          # regenerate after changing the schema
 *   bun run db:init-sql --check  # exit 1 if the file is out of date
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PACKAGE_DIR = resolve(import.meta.dir, '..');
export const INIT_SQL_PATH = resolve(PACKAGE_DIR, '../../db/init/01-schema.sql');

const HEADER = `-- Generated from packages/shared/src/db/schema.ts by \`bun run db:init-sql\`
-- (in packages/shared); do not edit by hand. Postgres runs it on the first start
-- of an empty data volume (docker-compose mounts db/init at /docker-entrypoint-initdb.d).

`;

export async function generateInitSql(): Promise<string> {
    const out = mkdtempSync(join(tmpdir(), 'forms-app-sql-'));
    try {
        const proc = Bun.spawn(
            [process.execPath, 'x', 'drizzle-kit', 'generate', '--dialect', 'postgresql', '--schema', 'src/db/schema.ts', '--out', out],
            { cwd: PACKAGE_DIR, stdout: 'pipe', stderr: 'pipe' },
        );
        const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
        if (code !== 0) throw new Error(`drizzle-kit generate failed (${code}): ${stderr}`);
        const file = readdirSync(out).find((f) => f.endsWith('.sql'));
        if (!file) throw new Error('drizzle-kit generated no SQL file');
        const sql = readFileSync(join(out, file), 'utf8').replaceAll('--> statement-breakpoint', '').trimEnd();
        return `${HEADER}${sql}\n`;
    } finally {
        rmSync(out, { recursive: true, force: true });
    }
}

if (import.meta.main) {
    const sql = await generateInitSql();
    if (process.argv.includes('--check')) {
        const current = readFileSync(INIT_SQL_PATH, 'utf8');
        if (current !== sql) {
            console.error(`${INIT_SQL_PATH} is out of date: run \`bun run db:init-sql\` in packages/shared`);
            process.exit(1);
        }
    } else {
        writeFileSync(INIT_SQL_PATH, sql);
        console.log(`wrote ${INIT_SQL_PATH}`);
    }
}
