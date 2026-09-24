/**
 * Transforms a JSON Schema object into Zod TypeScript source code.
 * Preserves errorMessage properties as Zod .message() parameters.
 *
 * Supports:
 * - string, number, integer, boolean types
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
    errorMessage?: Record<string, string>;
}

interface JsonSchema {
    type: 'object';
    properties: Record<string, JsonSchemaProperty>;
    required?: string[];
    errorMessage?: Record<string, string>;
}

function escapeString(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

function interpolateMessage(msg: string, values: Record<string, unknown>): string {
    return msg.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? key));
}

function transformProperty(
    name: string,
    prop: JsonSchemaProperty,
    isRequired: boolean,
): string {
    const msgs = prop.errorMessage ?? {};
    let chain: string;

    if (prop.enum && prop.enum.length > 0) {
        const enumValues = prop.enum.map((v) => `'${escapeString(String(v))}'`).join(', ');
        const enumMsg = msgs.type ? `, { message: '${escapeString(msgs.type)}' }` : '';
        chain = `z.enum([${enumValues}]${enumMsg})`;
    } else {
        switch (prop.type) {
            case 'string': {
                const typeMsg = msgs.type ? `{ message: '${escapeString(msgs.type)}' }` : '';
                chain = `z.string(${typeMsg})`;

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
                    chain += `.min(${prop.minLength}${msg ? `, ${msg}` : ''})`;
                }

                if (prop.maxLength !== undefined) {
                    const msg = msgs.maxLength
                        ? `'${escapeString(interpolateMessage(msgs.maxLength, { max: prop.maxLength }))}'`
                        : undefined;
                    chain += `.max(${prop.maxLength}${msg ? `, ${msg}` : ''})`;
                }

                if (prop.pattern) {
                    const msg = msgs.pattern
                        ? `, '${escapeString(msgs.pattern)}'`
                        : '';
                    chain += `.regex(/${prop.pattern}/${msg})`;
                }
                break;
            }

            case 'number':
            case 'integer': {
                const typeMsg = msgs.type ? `{ message: '${escapeString(msgs.type)}' }` : '';
                chain = prop.type === 'integer' ? `z.number(${typeMsg}).int()` : `z.number(${typeMsg})`;

                if (prop.minimum !== undefined) {
                    const msg = msgs.minimum
                        ? `'${escapeString(interpolateMessage(msgs.minimum, { min: prop.minimum }))}'`
                        : undefined;
                    chain += `.min(${prop.minimum}${msg ? `, ${msg}` : ''})`;
                }

                if (prop.maximum !== undefined) {
                    const msg = msgs.maximum
                        ? `'${escapeString(interpolateMessage(msgs.maximum, { max: prop.maximum }))}'`
                        : undefined;
                    chain += `.max(${prop.maximum}${msg ? `, ${msg}` : ''})`;
                }
                break;
            }

            case 'boolean': {
                chain = 'z.boolean()';
                break;
            }

            default: {
                chain = 'z.unknown()';
            }
        }
    }

    if (isRequired) {
        const reqMsg = msgs.required;
        if (reqMsg && (prop.type === 'string' || prop.type === undefined)) {
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

    const fields = Object.entries(properties).map(([name, prop]) => {
        const zodChain = transformProperty(name, prop, required.has(name));
        return `    ${name}: ${zodChain},`;
    });

    const lines = [
        "import { z } from 'zod';",
        '',
        'export const formSchema = z.object({',
        ...fields,
        '});',
    ];
    if (typeExport) lines.push('', 'export type FormData = z.infer<typeof formSchema>;');
    return lines.join('\n');
}
