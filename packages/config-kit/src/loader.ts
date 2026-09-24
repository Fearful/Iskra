import { z } from 'zod';
import { ConfigError } from '@iskra-bun/core';

export interface LoadConfigOptions<TSchema extends z.ZodTypeAny> {
    /** The Zod schema to validate the source against. */
    schema: TSchema;
    /**
     * The environment source to validate.
     * Defaults to `process.env`.
     */
    source?: Record<string, string | undefined>;
}

/**
 * Validates `source` (defaults to `process.env`) against the provided Zod schema
 * and returns a deep-frozen, typed config object.
 *
 * On failure, throws a `ConfigError` listing each invalid or missing field by name
 * and reason — never echoing secret values.
 */
export function loadConfig<TSchema extends z.ZodTypeAny>(
    options: LoadConfigOptions<TSchema>,
): z.output<TSchema> {
    const { schema, source = process.env } = options;

    const result = schema.safeParse(source, { errorMap: valueFreeErrors });

    if (!result.success) {
        const issues = result.error.issues.map(issue => {
            const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
            return `  • ${path}: ${issue.message}`;
        });

        throw new ConfigError(
            `Config validation failed:\n${issues.join('\n')}`,
            {
                context: {
                    // Only report field names and messages — never values.
                    fields: result.error.issues.map(i => ({
                        path: i.path.join('.') || '<root>',
                        message: i.message,
                    })),
                },
            },
        );
    }

    return deepFreeze(result.data) as z.output<TSchema>;
}

/**
 * Zod's own messages for enums and literals quote the value received
 * ("…, received 'hunter2'"); these say what was expected instead.
 */
const valueFreeErrors: z.ZodErrorMap = (issue, ctx) => {
    if (issue.code === z.ZodIssueCode.invalid_enum_value) {
        return { message: `Invalid enum value. Expected ${issue.options.map((o) => `'${String(o)}'`).join(' | ')}` };
    }
    if (issue.code === z.ZodIssueCode.invalid_literal) {
        return { message: `Invalid literal value, expected ${JSON.stringify(issue.expected)}` };
    }
    return { message: ctx.defaultError };
};

/**
 * Recursively freezes an object so the returned config is truly immutable.
 */
function deepFreeze<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') return obj;

    for (const key of Object.keys(obj as object)) {
        const value = (obj as Record<string, unknown>)[key];
        if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
            deepFreeze(value);
        }
    }

    return Object.freeze(obj);
}
