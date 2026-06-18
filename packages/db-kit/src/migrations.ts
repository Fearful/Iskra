import { type App } from '@iskra-bun/core';
import { MigrationError } from './errors';

export interface MigrationConfig {
    /** Dialecto de la base de datos */
    dialect: 'postgresql' | 'mysql' | 'sqlite';
    /** URL de conexión a la base de datos */
    dbUrl: string;
    /** Ruta al archivo de schema Drizzle (ej: './src/db/schema.ts') */
    schemaPath: string;
    /** Directorio donde se generan las migraciones (ej: './drizzle') */
    migrationsDir: string;
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
     */
    async generate(name?: string): Promise<void> {
        const args = ['drizzle-kit', 'generate'];
        if (name) args.push('--name', name);
        await this.exec(args, 'generate');
    }

    /**
     * Aplica las migraciones pendientes a la base de datos.
     */
    async migrate(): Promise<void> {
        await this.exec(['drizzle-kit', 'migrate'], 'migrate');
    }

    /**
     * Empuja el schema directamente a la base de datos (sin generar archivos de migración).
     * Útil para desarrollo rápido.
     */
    async push(): Promise<void> {
        await this.exec(['drizzle-kit', 'push'], 'push');
    }

    /**
     * Elimina todas las tablas de la base de datos.
     */
    async drop(): Promise<void> {
        await this.exec(['drizzle-kit', 'drop'], 'drop');
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
                    context: { operation, exitCode, stderr: stderr.trim() },
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
