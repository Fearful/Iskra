import { z } from 'zod';

// The messages never include the value: it may be a secret (a password put in
// the wrong variable), and loadConfig() reports them in errors and logs.

/**
 * Coerce a string env var to boolean.
 * Accepts "true"/"1"/"yes" as true, "false"/"0"/"no" as false.
 * Rejects any other value.
 */
export const envBool = z
    .string()
    .transform((val, ctx) => {
        const lower = val.toLowerCase().trim();
        if (lower === 'true' || lower === '1' || lower === 'yes') return true;
        if (lower === 'false' || lower === '0' || lower === 'no') return false;
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Expected boolean-like string ("true"/"1"/"yes"/"false"/"0"/"no")',
        });
        return z.NEVER;
    })
    .pipe(z.boolean());

/**
 * Coerce a string env var to a finite number.
 */
export const envNumber = z
    .string()
    .transform((val, ctx) => {
        const trimmed = val.trim();
        const n = Number(trimmed);
        if (trimmed === '' || !Number.isFinite(n)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Expected a finite number',
            });
            return z.NEVER;
        }
        return n;
    })
    .pipe(z.number());

/**
 * Coerce a string env var to a valid TCP port (1–65535).
 */
export const envPort = z
    .string()
    .transform((val, ctx) => {
        const n = Number(val);
        if (!Number.isInteger(n) || n < 1 || n > 65535) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Expected a port number (1–65535)',
            });
            return z.NEVER;
        }
        return n;
    })
    .pipe(z.number().int().min(1).max(65535));

/**
 * Coerce a string env var to one of the provided literal values.
 * Usage: envEnum(['development', 'production', 'test'])
 */
export function envEnum<T extends string>(values: readonly [T, ...T[]]) {
    return z
        .string()
        .transform((val, ctx) => {
            if (!(values as readonly string[]).includes(val)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Expected one of [${values.map(v => `"${v}"`).join(', ')}]`,
                });
                return z.NEVER;
            }
            return val as T;
        })
        .pipe(z.enum(values));
}
