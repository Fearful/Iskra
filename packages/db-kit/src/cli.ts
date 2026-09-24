#!/usr/bin/env bun
/**
 * CLI para migraciones de Iskra DB Kit.
 *
 * Uso:
 *   bun run packages/db-kit/src/cli.ts generate [nombre]
 *   bun run packages/db-kit/src/cli.ts migrate
 *   bun run packages/db-kit/src/cli.ts push
 *   bun run packages/db-kit/src/cli.ts drop
 *
 * Requiere un archivo drizzle.config.ts en el directorio actual.
 */

const [command, ...rest] = process.argv.slice(2);

const validCommands = ['generate', 'migrate', 'push', 'drop'];

if (!command || !validCommands.includes(command)) {
    console.log(`
Iskra DB Kit — CLI de Migraciones

Uso:
  bun run packages/db-kit/src/cli.ts <comando> [opciones]

Comandos:
  generate [nombre]  Genera archivos de migración a partir del schema
  migrate            Aplica migraciones pendientes
  push               Empuja el schema directo a la DB (sin migración)
  drop               Elimina un archivo de migracion generado (no toca la DB)
`);
    process.exit(command ? 1 : 0);
}

const args = ['bunx', 'drizzle-kit', command, ...rest];

console.log(`> ${args.join(' ')}`);

const proc = Bun.spawn(args, {
    cwd: process.cwd(),
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env as Record<string, string>,
});

const exitCode = await proc.exited;
process.exit(exitCode);

export {};
