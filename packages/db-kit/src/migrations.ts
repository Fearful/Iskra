import { type App } from '@iskra-bun/core';
import { MigrationError } from './errors';
import { SENSITIVE_URL_PARAM } from './secrets';

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
 * Usa `bunx drizzle-kit` como subproceso para generar y aplicar migraciones.
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
        const args = ['drizzle-kit', 'generate'];
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
        const args = ['drizzle-kit', 'migrate'];
        if (this.config.configPath) args.push('--config', this.config.configPath);
        await this.exec(args, 'migrate');
    }

    /**
     * Empuja el schema directamente a la base de datos (sin generar archivos de migración).
     * Útil para desarrollo rápido. `push` acepta --schema pero no --out.
     */
    async push(): Promise<void> {
        const args = ['drizzle-kit', 'push'];
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
        const args = ['drizzle-kit', 'drop'];
        if (this.config.migrationsDir) args.push('--out', this.config.migrationsDir);
        if (this.config.configPath) args.push('--config', this.config.configPath);
        await this.exec(args, 'drop');
    }

    private async exec(args: string[], operation: string): Promise<void> {
        const env: Record<string, string> = {
            ...process.env as Record<string, string>,
            DATABASE_URL: this.config.dbUrl,
        };

        this.app?.logger.info(`Running migration: ${operation}`);

        try {
            const proc = Bun.spawn(['bunx', ...args], {
                cwd: process.cwd(),
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
