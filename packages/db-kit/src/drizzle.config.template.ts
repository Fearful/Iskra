import { defineConfig } from 'drizzle-kit';

export interface DrizzleConfigOptions {
    /** Dialecto: 'postgresql', 'mysql', 'sqlite' */
    dialect: 'postgresql' | 'mysql' | 'sqlite';
    /** URL de conexión a la base de datos */
    dbUrl: string;
    /** Ruta al archivo de schema (ej: './src/db/schema.ts') */
    schemaPath: string;
    /** Directorio de migraciones (ej: './drizzle') */
    migrationsDir?: string;
}

/**
 * Crea una configuración de drizzle-kit reutilizable.
 *
 * Uso en tu proyecto:
 * ```ts
 * // drizzle.config.ts
 * import { createDrizzleConfig } from '@iskra-bun/db-kit';
 *
 * export default createDrizzleConfig({
 *     dialect: 'sqlite',
 *     dbUrl: process.env.DATABASE_URL || 'app.db',
 *     schemaPath: './src/db/schema.ts',
 * });
 * ```
 */
export function createDrizzleConfig(options: DrizzleConfigOptions) {
    return defineConfig({
        dialect: options.dialect,
        schema: options.schemaPath,
        out: options.migrationsDir || './drizzle',
        dbCredentials: {
            url: options.dbUrl,
        },
    });
}
