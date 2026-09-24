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
 * La configuración que lee drizzle-kit (el `export default` de `drizzle.config.ts`).
 * Se declara aquí para no importar drizzle-kit: es una herramienta de desarrollo,
 * y el entry point de db-kit (que usa Bun vía la condición `bun`) fallaba al
 * importarse donde no estaba instalada, por ejemplo con `--production`.
 */
export interface DrizzleKitConfig {
    dialect: DrizzleConfigOptions['dialect'];
    schema: string;
    out: string;
    dbCredentials: { url: string };
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
export function createDrizzleConfig(options: DrizzleConfigOptions): DrizzleKitConfig {
    return {
        dialect: options.dialect,
        schema: options.schemaPath,
        out: options.migrationsDir || './drizzle',
        dbCredentials: {
            url: options.dbUrl,
        },
    };
}
