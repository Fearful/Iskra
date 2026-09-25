/**
 * Transforms a JSON Schema object into Zod TypeScript source code.
 * Preserves errorMessage properties as Zod .message() parameters.
 *
 * Supports:
 * - string, number, integer, boolean and array (of enum strings) types
 * - format: email, date, uri
 * - minLength, maxLength, minimum, maximum, pattern
 * - enum
 * - required fields
 * - errorMessage object per property (AJV ajv-errors format)
 */

interface JsonSchemaProperty {
    type?: string;
    format?: string;
    minLength?: number;
    maxLength?: number;
    minimum?: number;
    maximum?: number;
    pattern?: string;
    enum?: (string | number)[];
    const?: unknown;
    items?: { type?: string; enum?: (string | number)[] };
    minItems?: number;
    errorMessage?: Record<string, string>;
}

interface JsonSchema {
    type: 'object';
    properties: Record<string, JsonSchemaProperty>;
    required?: string[];
    additionalProperties?: boolean;
    /** ajv-errors messages for the object; `required` maps field names to messages. */
    errorMessage?: { required?: Record<string, string> } & Record<string, unknown>;
}

/** Escapes text for a single-quoted JS string literal in the generated module. */
function escapeString(str: string): string {
    return str
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

/**
 * An object key for the generated module: bare when it is an identifier,
 * quoted otherwise. `__proto__`, bare or quoted, would set the prototype of the
 * shape object instead of adding the field, so the field went unvalidated.
 */
function propertyKey(name: string): string {
    if (name === '__proto__') throw new Error('JSON Schema: "__proto__" is not a valid property name');
    return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

/**
 * A schema number for the generated code. Written into it as is, so anything
 * but a finite number (e.g. the string `"(fetch(...), 5)"` from a schema that
 * was not built by the admin API) would run in every visitor's browser.
 */
function literalNumber(value: unknown, keyword: string, { integer = false } = {}): string {
    const valid = typeof value === 'number' && Number.isFinite(value) && (!integer || Number.isInteger(value));
    if (!valid) throw new Error(`JSON Schema: "${keyword}" must be a${integer ? 'n integer' : ' finite number'}`);
    return String(value);
}

function interpolateMessage(msg: string, values: Record<string, unknown>): string {
    return msg.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? key));
}

/**
 * Zod params giving a missing value the required message and a value of the
 * wrong type (or not among the options) the type message; the checks' own
 * issues (min, max, format…) keep theirs.
 */
function createParams(typeMsg: string | undefined, requiredMsg: string | undefined): string {
    if (!typeMsg && !requiredMsg) return '';
    const req = requiredMsg ? `'${escapeString(requiredMsg)}'` : 'ctx.defaultError';
    const type = typeMsg ? `'${escapeString(typeMsg)}'` : 'ctx.defaultError';
    return (
        `{ errorMap: (issue, ctx) => ({ message: ctx.data === undefined ? ${req}` +
        ` : issue.code === 'invalid_type' || issue.code === 'invalid_enum_value' ? ${type} : ctx.defaultError }) }`
    );
}

function enumOf(values: (string | number)[], params: string): string {
    const list = values.map((v) => `'${escapeString(String(v))}'`).join(', ');
    return `z.enum([${list}]${params ? `, ${params}` : ''})`;
}

function transformProperty(
    name: string,
    prop: JsonSchemaProperty,
    isRequired: boolean,
    requiredMessage?: string,
): string {
    const msgs = prop.errorMessage ?? {};
    const reqMsg = isRequired ? (requiredMessage ?? msgs.required) : undefined;
    const params = createParams(msgs.type, reqMsg);
    let chain: string;

    if (prop.enum && prop.enum.length > 0) {
        // A required select sends nothing when left empty, so the params'
        // required message covers it (a .min() here threw: enums have none,
        // and the whole form's script failed to load).
        chain = enumOf(prop.enum, params);
    } else {
        switch (prop.type) {
            case 'string': {
                chain = `z.string(${params})`;

                if (prop.format === 'email') {
                    const fmtMsg = msgs.format
                        ? `'${escapeString(msgs.format)}'`
                        : "'Please enter a valid email address'";
                    chain += `.email(${fmtMsg})`;
                } else if (prop.format === 'date') {
                    chain += `.date()`;
                } else if (prop.format === 'uri') {
                    const fmtMsg = msgs.format ? `'${escapeString(msgs.format)}'` : undefined;
                    chain += `.url(${fmtMsg ?? ''})`;
                }

                if (prop.minLength !== undefined) {
                    const msg = msgs.minLength
                        ? `'${escapeString(interpolateMessage(msgs.minLength, { min: prop.minLength }))}'`
                        : undefined;
                    chain += `.min(${literalNumber(prop.minLength, 'minLength', { integer: true })}${msg ? `, ${msg}` : ''})`;
                }

                if (prop.maxLength !== undefined) {
                    const msg = msgs.maxLength
                        ? `'${escapeString(interpolateMessage(msgs.maxLength, { max: prop.maxLength }))}'`
                        : undefined;
                    chain += `.max(${literalNumber(prop.maxLength, 'maxLength', { integer: true })}${msg ? `, ${msg}` : ''})`;
                }

                if (prop.pattern) {
                    const msg = msgs.pattern
                        ? `, '${escapeString(msgs.pattern)}'`
                        : '';
                    // new RegExp(<string literal>): spliced into a /literal/, a "/" in the
                    // pattern ended the regex and the rest ran as code.
                    chain += `.regex(new RegExp(${JSON.stringify(prop.pattern)})${msg})`;
                }
                break;
            }

            case 'number':
            case 'integer': {
                chain = prop.type === 'integer' ? `z.number(${params}).int()` : `z.number(${params})`;

                if (prop.minimum !== undefined) {
                    const msg = msgs.minimum
                        ? `'${escapeString(interpolateMessage(msgs.minimum, { min: prop.minimum }))}'`
                        : undefined;
                    chain += `.min(${literalNumber(prop.minimum, 'minimum')}${msg ? `, ${msg}` : ''})`;
                }

                if (prop.maximum !== undefined) {
                    const msg = msgs.maximum
                        ? `'${escapeString(interpolateMessage(msgs.maximum, { max: prop.maximum }))}'`
                        : undefined;
                    chain += `.max(${literalNumber(prop.maximum, 'maximum')}${msg ? `, ${msg}` : ''})`;
                }
                break;
            }

            case 'boolean': {
                chain = `z.boolean(${params})`;
                if (prop.const === true) {
                    // A required checkbox must be checked.
                    chain += `.refine((v) => v === true, '${escapeString(reqMsg ?? msgs.const ?? 'Required')}')`;
                }
                break;
            }

            case 'array': {
                const item = prop.items?.enum?.length ? enumOf(prop.items.enum, '') : 'z.string()';
                chain = `z.array(${item}${params ? `, ${params}` : ''})`;
                if (prop.minItems) {
                    chain += `.min(${literalNumber(prop.minItems, 'minItems', { integer: true })}, '${escapeString(msgs.minItems ?? reqMsg ?? 'Required')}')`;
                }
                break;
            }

            default: {
                chain = 'z.unknown()';
            }
        }
    }

    if (isRequired) {
        // An empty text answer: strings only, never an enum.
        if (reqMsg && !prop.enum?.length && (prop.type === 'string' || prop.type === undefined)) {
            chain += `.min(1, '${escapeString(reqMsg)}')`;
        }
    } else {
        chain += '.optional()';
    }

    return chain;
}

export interface TransformOptions {
    /**
     * Append `export type FormData = z.infer<typeof formSchema>` (default true).
     * Off for the Vite virtual module, which must be plain JavaScript: Vite
     * does not transpile virtual ids, so Rollup failed to parse the type.
     */
    typeExport?: boolean;
}

export function transformJsonSchemaToZod(schema: JsonSchema, { typeExport = true }: TransformOptions = {}): string {
    const required = new Set(schema.required ?? []);
    const properties = schema.properties ?? {};

    const requiredMessages = schema.errorMessage?.required ?? {};

    const fields = Object.entries(properties).map(([name, prop]) => {
        const key = propertyKey(name);
        // Own keys only: a field named "constructor" read Object from the prototype.
        const requiredMessage = Object.hasOwn(requiredMessages, name) ? requiredMessages[name] : undefined;
        const zodChain = transformProperty(name, prop, required.has(name), requiredMessage);
        return `    ${key}: ${zodChain},`;
    });

    const lines = [
        "import { z } from 'zod';",
        '',
        'export const formSchema = z.object({',
        ...fields,
        schema.additionalProperties === false ? '}).strict();' : '});',
    ];
    if (typeExport) lines.push('', 'export type FormData = z.infer<typeof formSchema>;');
    return lines.join('\n');
}
