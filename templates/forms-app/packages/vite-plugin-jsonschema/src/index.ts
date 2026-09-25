import type { Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { transformJsonSchemaToZod } from './transform.ts';

const VIRTUAL_PREFIX = 'virtual:form-validation/';
const RESOLVED_PREFIX = '\0virtual:form-validation/';
// Bare imports of the generated modules (zod) resolve from this package: the
// build root is often a temp directory without node_modules (form-manager's
// pre-render builds in a private one, form-build-* under os.tmpdir()).
const RESOLVE_FROM = fileURLToPath(import.meta.url);

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
                // Plain JS: Vite does not transpile virtual modules.
                const zodSource = transformJsonSchemaToZod(entry.schema as any, { typeExport: false });
                generated.set(entry.id, zodSource);
            }
        },

        resolveId(source, importer, options) {
            if (source.startsWith(VIRTUAL_PREFIX)) {
                return '\0' + source;
            }
            if (importer?.startsWith(RESOLVED_PREFIX)) {
                return this.resolve(source, RESOLVE_FROM, { ...options, skipSelf: true });
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

export { transformJsonSchemaToZod, type TransformOptions } from './transform.ts';
export type { SchemaEntry } from './codegen.ts';
export { generateZodFile } from './codegen.ts';
