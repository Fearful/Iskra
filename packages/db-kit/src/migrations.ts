import { type App } from '@iskra-bun/core';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { MigrationError } from './errors';
import { SENSITIVE_URL_PARAM } from './secrets';

/**
 * The drizzle-kit command to run `args` with, from the project's own install:
 * `node_modules/.bin` in `cwd` or a parent (workspaces hoist it). drizzle-kit
 * is a devDependency, and `bunx drizzle-kit` downloaded its latest release
 * from npm where it was missing (a production install) and ran it with
 * DATABASE_URL in its environment. `--no-install` keeps bunx from doing so.
 */
export function drizzleKitCommand(args: string[], cwd: string = process.cwd()): string[] {
    for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
        const bin = path.join(dir, 'node_modules', '.bin', 'drizzle-kit');
        if (['', '.exe', '.cmd'].some((ext) => existsSync(bin + ext))) {
            return ['bunx', '--no-install', 'drizzle-kit', ...args];
        }
        if (path.dirname(dir) === dir) break;
    }
    throw new MigrationError(
        'drizzle-kit is not installed in this project (it is never downloaded at run time): ' +
            'add it with `bun add -d drizzle-kit`',
        { context: { cwd } },
    );
}

/**
 * Redacta credenciales `//user:pass@host` y parámetros secretos (`authToken`,
 * `password`...) embebidos en texto arbitrario (p. ej. el stderr de drizzle-kit,
 * que suele imprimir la cadena de conexión completa al fallar). A diferencia de
 * `scrubUrl`, opera sobre texto libre y no requiere que el contenido sea una
 * URL parseable, dejando intacto el resto del diagnóstico. Una contraseña con
 * `@` o `/` sin codificar también se redacta: se toma hasta el último `@`.
 *
 * e.g. "... postgres://user:pass@host:5432/db" → "... postgres://***:***@host:5432/db"
 */
export function scrubCredentials(text: string): string {
    return text
        .replace(/(\/\/)(?:[^\s'"`@]*@)+/g, '$1***:***@')
        .replace(
            new RegExp(`([?&][^=\\s&'"\`]*(?:${SENSITIVE_URL_PARAM.source})[^=\\s&'"\`]*=)[^&\\s'"\`]*`, 'gi'),
            '$1***',
        );
}

export interface MigrationConfig {
    /** Dialecto de la base de datos */
    dialect: 'postgresql' | 'mysql' | 'sqlite';
    /** URL de conexión a la base de datos */
    dbUrl: string;
    /** Ruta al archivo de schema Drizzle (ej: './src/db/schema.ts') */
    schemaPath: string;
    /** Directorio donde se generan las migraciones (ej: './drizzle') */
    migrationsDir: string;
    /** Ruta opcional a un drizzle.config.ts; cuando se define se pasa como --config. */
    configPath?: string;
}

/**
 * Helper para ejecutar migraciones de Drizzle Kit.
 * Usa el drizzle-kit instalado en el proyecto (`bunx --no-install drizzle-kit`)
 * como subproceso para generar y aplicar migraciones; nunca lo descarga.
 */
export class MigrationHelper {
    private config: MigrationConfig;
    private app?: App;

    constructor(config: MigrationConfig, app?: App) {
        this.config = config;
        this.app = app;
    }

    /**
     * Genera archivos de migración basados en los cambios del schema.
     * drizzle-kit generate soporta --schema y --out, así que ambos se reenvían
     * desde la config (antes se ignoraban silenciosamente).
     */
    async generate(name?: string): Promise<void> {
        const args = ['generate'];
        if (this.config.schemaPath) args.push('--schema', this.config.schemaPath);
        if (this.config.migrationsDir) args.push('--out', this.config.migrationsDir);
        if (name) args.push('--name', name);
        if (this.config.configPath) args.push('--config', this.config.configPath);
        await this.exec(args, 'generate');
    }

    /**
     * Aplica las migraciones pendientes a la base de datos.
     * `migrate` sólo acepta --config; schema y out no son flags válidos en este
     * comando, por eso únicamente reenviamos configPath cuando está presente.
     */
    async migrate(): Promise<void> {
        const args = ['migrate'];
        if (this.config.configPath) args.push('--config', this.config.configPath);
        await this.exec(args, 'migrate');
    }

    /**
     * Empuja el schema directamente a la base de datos (sin generar archivos de migración).
     * Útil para desarrollo rápido. `push` acepta --schema pero no --out.
     */
    async push(): Promise<void> {
        const args = ['push'];
        if (this.config.schemaPath) args.push('--schema', this.config.schemaPath);
        if (this.config.configPath) args.push('--config', this.config.configPath);
        await this.exec(args, 'push');
    }

    /**
     * Elimina un archivo de migración ya generado (`drizzle-kit drop`, interactivo).
     * No borra tablas ni datos de la base.
     * `drop` acepta --out (dónde viven las migraciones) pero no --schema.
     */
    async drop(): Promise<void> {
        const args = ['drop'];
        if (this.config.migrationsDir) args.push('--out', this.config.migrationsDir);
        if (this.config.configPath) args.push('--config', this.config.configPath);
        await this.exec(args, 'drop');
    }

    private async exec(args: string[], operation: string): Promise<void> {
        const env: Record<string, string> = {
            ...(process.env as Record<string, string>),
            DATABASE_URL: this.config.dbUrl,
        };
        const cwd = process.cwd();
        // Before anything runs with DATABASE_URL: never a downloaded drizzle-kit.
        const command = drizzleKitCommand(args, cwd);

        this.app?.logger.info(`Running migration: ${operation}`);

        try {
            const proc = Bun.spawn(command, {
                cwd,
                env,
                stdout: 'pipe',
                stderr: 'pipe',
            });

            const exitCode = await proc.exited;
            const stdout = await new Response(proc.stdout).text();
            const stderr = await new Response(proc.stderr).text();

            if (stdout) this.app?.logger.info(stdout.trim());

            if (exitCode !== 0) {
                throw new MigrationError(`Migration ${operation} failed with exit code ${exitCode}`, {
                    context: { operation, exitCode, stderr: scrubCredentials(stderr.trim()) },
                });
            }

            this.app?.logger.info(`Migration ${operation} completed successfully`);
        } catch (error) {
            if (error instanceof MigrationError) throw error;
            throw new MigrationError(`Migration ${operation} failed`, {
                cause: error instanceof Error ? error : new Error(String(error)),
                context: { operation },
            });
        }
    }
}

/**
 * Mapea el driver de Iskra al dialecto de Drizzle Kit.
 */
export function mapDialect(driver: string): MigrationConfig['dialect'] {
    switch (driver) {
        case 'postgres':
            return 'postgresql';
        case 'mysql':
            return 'mysql';
        case 'sqlite':
        case 'libsql':
            return 'sqlite';
        default:
            throw new MigrationError(`Cannot map driver "${driver}" to a Drizzle dialect`, {
                context: { driver },
            });
    }
}
