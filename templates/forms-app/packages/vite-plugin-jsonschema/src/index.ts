import type { Plugin } from 'vite';
import { transformJsonSchemaToZod } from './transform.ts';

const VIRTUAL_PREFIX = 'virtual:form-validation/';
const RESOLVED_PREFIX = '\0virtual:form-validation/';

export interface JsonSchemaPluginOptions {
    schemas: Array<{
        id: string;
        schema: {
            type: 'object';
            properties: Record<string, unknown>;
            required?: string[];
        };
    }>;
}

export default function jsonSchemaPlugin(options: JsonSchemaPluginOptions): Plugin {
    const generated = new Map<string, string>();

    return {
        name: 'vite-plugin-jsonschema',

        buildStart() {
            for (const entry of options.schemas) {
                const zodSource = transformJsonSchemaToZod(entry.schema as any);
                generated.set(entry.id, zodSource);
            }
        },

        resolveId(source) {
            if (source.startsWith(VIRTUAL_PREFIX)) {
                return '\0' + source;
            }
        },

        load(id) {
            if (id.startsWith(RESOLVED_PREFIX)) {
                const schemaId = id.slice(RESOLVED_PREFIX.length);
                const source = generated.get(schemaId);
                if (source) return source;
                this.error(`JSON Schema not found for id: ${schemaId}`);
            }
        },
    };
}

export { transformJsonSchemaToZod } from './transform.ts';
export type { SchemaEntry } from './codegen.ts';
export { generateZodFile } from './codegen.ts';
