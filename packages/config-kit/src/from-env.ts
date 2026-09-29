import { ConfigError } from '@iskra-bun/core';

/** What converts a variable's text: a Zod schema of a string (`envNumber`, `envPort`…). */
export interface EnvParser<T> {
    safeParse(
        value: string,
    ): { success: true; data: T } | { success: false; error: { issues: ReadonlyArray<{ message: string }> } };
}

/** A config field read from environment variables. */
export interface EnvField<T> {
    readonly kind: 'env';
    /** The variables to read, the first one set wins (a new name, then the legacy one). */
    readonly names: readonly string[];
    readonly schema?: EnvParser<T>;
    readonly default?: T;
    readonly optional: boolean;
}

/**
 * A field read from `names` (the first set, an empty value counts as unset),
 * converted by `schema` (`envNumber`, `envPort`, `envBool`, `envEnum([...])`
 * or any Zod schema of a string); text by default. A field without a value
 * and without `default` is an error, unless `optional`.
 */
export function env(names: string | readonly string[]): EnvField<string>;
export function env<T>(names: string | readonly string[], schema: EnvParser<T>, options?: { default?: T }): EnvField<T>;
export function env<T>(
    names: string | readonly string[],
    schema: EnvParser<T> | undefined,
    options: { optional: true },
): EnvField<T | undefined>;
export function env<T>(
    names: string | readonly string[],
    schema?: EnvParser<T>,
    options: { default?: T; optional?: boolean } = {},
): EnvField<T> {
    return {
        kind: 'env',
        names: typeof names === 'string' ? [names] : names,
        schema,
        default: options.default,
        optional: options.optional === true,
    };
}

/** A section: each key a variable name (text), an `env()` field, or a nested section. */
export interface EnvSpec {
    readonly [key: string]: string | readonly string[] | EnvField<unknown> | EnvSpec;
}

type Value<E> = E extends EnvField<infer T> ? T : E extends string | readonly string[] ? string : FromEnv<E>;

/** The keys of optional fields, which may be missing from the config. */
type OptionalKeys<S> = {
    [K in keyof S]: S[K] extends EnvField<infer T> ? (undefined extends T ? K : never) : never;
}[keyof S];

/** The config a spec reads: an optional field's key may be missing. */
export type FromEnv<S> = {
    -readonly [K in Exclude<keyof S, OptionalKeys<S>>]: Value<S[K]>;
} & {
    -readonly [K in OptionalKeys<S>]?: Exclude<Value<S[K]>, undefined>;
};

const isField = (value: unknown): value is EnvField<unknown> =>
    typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'env';

function read(
    spec: EnvSpec,
    source: Readonly<Record<string, string | undefined>>,
    problems: string[],
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(spec)) {
        if (typeof entry === 'string' || Array.isArray(entry) || isField(entry)) {
            const field = isField(entry) ? entry : env(entry as string | readonly string[]);
            const name = field.names.find((n) => source[n] !== undefined && source[n] !== '');
            const label = field.names.join(' or ');
            if (name === undefined) {
                if (field.default !== undefined) out[key] = field.default;
                else if (!field.optional) problems.push(`${label} is not set`);
                continue;
            }
            if (!field.schema) {
                out[key] = source[name];
                continue;
            }
            const parsed = field.schema.safeParse(source[name]!);
            // The message never includes the value: it may be a secret.
            if (parsed.success) out[key] = parsed.data;
            else problems.push(`${name}: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
        } else {
            out[key] = read(entry as EnvSpec, source, problems);
        }
    }
    return out;
}

/**
 * A config section from environment variables with names of your own (or a
 * legacy service's), validated, with defaults:
 *
 * ```ts
 * // app.config.ts
 * export default {
 *     oracle: fromEnv({
 *         host: 'DB_HOST_ORACLE',
 *         port: env('DB_PORT_ORACLE', envPort, { default: 1521 }),
 *         serviceName: env(['DB_SERVICE_ORACLE', 'ORA_SERVICE']),
 *         user: 'DB_USER_ORACLE',
 *         password: 'DB_PASS_ORACLE',
 *         pool: { max: env('DB_POOL_MAX', envNumber, { default: 4 }) },
 *     }),
 * };
 * ```
 *
 * Every problem is reported at once in a `ConfigError` that names the
 * variables, never their values.
 */
export function fromEnv<const S extends EnvSpec>(
    spec: S,
    options: { source?: Readonly<Record<string, string | undefined>> } = {},
): FromEnv<S> {
    const problems: string[] = [];
    const config = read(spec, options.source ?? process.env, problems);
    if (problems.length > 0) {
        throw new ConfigError(`Invalid config from the environment:\n${problems.map((p) => `  - ${p}`).join('\n')}`, {
            context: { variables: problems.length },
        });
    }
    return config as FromEnv<S>;
}
