import { describe, it, expect } from 'bun:test';
import { z } from 'zod';
import { transformJsonSchemaToZod } from '../src/transform';

/** Evaluates the generated module and returns its formSchema. */
function load(code: string) {
    const body = code.replace("import { z } from 'zod';", '').replace('export const formSchema =', 'return');
    return new Function('z', body)(z) as z.ZodTypeAny;
}

const messages = (schema: z.ZodTypeAny, data: unknown) => {
    const result = schema.safeParse(data);
    return result.success ? [] : result.error.issues.map((i) => i.message);
};

describe('transformJsonSchemaToZod', () => {
    it('wraps fields in a formSchema object and exports the inferred type', () => {
        const code = transformJsonSchemaToZod({
            type: 'object',
            properties: { name: { type: 'string' } },
            required: [],
        });
        expect(code).toContain("import { z } from 'zod';");
        expect(code).toContain('export const formSchema = z.object({');
        expect(code).toContain('export type FormData = z.infer<typeof formSchema>;');
    });

    it('marks required string fields and applies maxLength with an interpolated message', () => {
        const code = transformJsonSchemaToZod({
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    maxLength: 5,
                    errorMessage: { maxLength: 'Max {max} chars', required: 'Required!' },
                },
            },
            required: ['name'],
        });
        const schema = load(code.split('\n\nexport type')[0]);
        expect(messages(schema, {})).toEqual(['Required!']);
        expect(messages(schema, { name: '' })).toEqual(['Required!']);
        expect(messages(schema, { name: 'abcdef' })).toEqual(['Max 5 chars']);
    });

    it('makes non-required fields optional', () => {
        const code = transformJsonSchemaToZod({
            type: 'object',
            properties: { nick: { type: 'string' } },
            required: [],
        });
        expect(code).toContain('nick: z.string().optional(),');
    });

    it('emits .email() with a custom or default message', () => {
        const custom = transformJsonSchemaToZod({
            type: 'object',
            properties: { e: { type: 'string', format: 'email', errorMessage: { format: 'Bad email' } } },
            required: ['e'],
        });
        expect(custom).toContain("z.string().email('Bad email')");

        const dflt = transformJsonSchemaToZod({
            type: 'object',
            properties: { e: { type: 'string', format: 'email' } },
            required: ['e'],
        });
        expect(dflt).toContain("z.string().email('Please enter a valid email address')");
    });

    it('supports date and uri formats', () => {
        const date = transformJsonSchemaToZod({
            type: 'object',
            properties: { d: { type: 'string', format: 'date' } },
            required: ['d'],
        });
        expect(date).toContain('z.string().date()');

        const uri = transformJsonSchemaToZod({
            type: 'object',
            properties: { u: { type: 'string', format: 'uri' } },
            required: ['u'],
        });
        expect(uri).toContain('z.string().url()');
    });

    it('handles number and integer with min/max and interpolated messages', () => {
        const num = transformJsonSchemaToZod({
            type: 'object',
            properties: {
                age: {
                    type: 'number',
                    minimum: 0,
                    maximum: 120,
                    errorMessage: { minimum: 'min {min}', maximum: 'max {max}' },
                },
            },
            required: ['age'],
        });
        expect(num).toContain("age: z.number().min(0, 'min 0').max(120, 'max 120'),");

        const int = transformJsonSchemaToZod({
            type: 'object',
            properties: { n: { type: 'integer' } },
            required: ['n'],
        });
        expect(int).toContain('n: z.number().int(),');
    });

    it('renders enum fields with an optional message', () => {
        const code = transformJsonSchemaToZod({
            type: 'object',
            properties: { color: { type: 'string', enum: ['red', 'blue'], errorMessage: { type: 'pick one' } } },
            required: ['color'],
        });
        const schema = load(code.split('\n\nexport type')[0]);
        expect(messages(schema, { color: 'green' })).toEqual(['pick one']);
        expect(schema.safeParse({ color: 'red' }).success).toBe(true);
    });

    it('gives a required select its required message without breaking the module', () => {
        // `.min(1, …)` on an enum threw when the page's script loaded.
        const schema = load(
            transformJsonSchemaToZod(
                {
                    type: 'object',
                    properties: { color: { type: 'string', enum: ['red'], errorMessage: { type: 'pick one' } } },
                    required: ['color'],
                    errorMessage: { required: { color: 'Choose a color' } },
                },
                { typeExport: false },
            ),
        );
        expect(messages(schema, {})).toEqual(['Choose a color']);
    });

    it('uses the object-level required messages the server schema carries', () => {
        const schema = load(
            transformJsonSchemaToZod(
                {
                    type: 'object',
                    properties: { age: { type: 'number' }, mail: { type: 'string', format: 'email' } },
                    required: ['age', 'mail'],
                    errorMessage: { required: { age: 'Age?', mail: 'Mail?' } },
                },
                { typeExport: false },
            ),
        );
        expect(messages(schema, {})).toEqual(['Age?', 'Mail?']);
    });

    it('requires a checked checkbox and handles several options as an array', () => {
        const schema = load(
            transformJsonSchemaToZod(
                {
                    type: 'object',
                    properties: {
                        terms: { type: 'boolean', const: true },
                        tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'] }, minItems: 1 },
                    },
                    required: ['terms', 'tags'],
                    errorMessage: { required: { terms: 'Accept', tags: 'Pick' } },
                    additionalProperties: false,
                },
                { typeExport: false },
            ),
        );
        expect(messages(schema, { terms: false, tags: [] })).toEqual(['Accept', 'Pick']);
        expect(schema.safeParse({ terms: true, tags: ['a', 'b'] }).success).toBe(true);
        expect(schema.safeParse({ terms: true, tags: ['c'] }).success).toBe(false);
        // additionalProperties: false
        expect(schema.safeParse({ terms: true, tags: ['a'], extra: 1 }).success).toBe(false);
    });

    it('renders boolean fields and an unknown fallback', () => {
        const code = transformJsonSchemaToZod({
            type: 'object',
            properties: { agree: { type: 'boolean' }, weird: { type: 'blah' as any } },
            required: ['agree', 'weird'],
        });
        expect(code).toContain('agree: z.boolean(),');
        expect(code).toContain('weird: z.unknown(),');
    });

    it('applies a regex pattern', () => {
        const code = transformJsonSchemaToZod({
            type: 'object',
            properties: { code: { type: 'string', pattern: '^[A-Z]+$', errorMessage: { pattern: 'caps only' } } },
            required: ['code'],
        });
        expect(code).toContain(`.regex(new RegExp("^[A-Z]+$"), 'caps only')`);
    });

    it('escapes single quotes and newlines in messages', () => {
        const code = transformJsonSchemaToZod({
            type: 'object',
            properties: { x: { type: 'string', minLength: 2, errorMessage: { minLength: "it's\nbad" } } },
            required: ['x'],
        });
        expect(code).toContain("it\\'s\\nbad");
    });

    it('handles an empty schema', () => {
        const code = transformJsonSchemaToZod({ type: 'object', properties: {}, required: [] });
        expect(code).toContain('export const formSchema = z.object({');
        expect(code).toContain('});');
    });
});
