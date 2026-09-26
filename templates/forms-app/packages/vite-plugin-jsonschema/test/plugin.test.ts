import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import jsonSchemaPlugin from '../src/index';

// form-manager pre-renders every form with a real Vite build, rooted in a temp
// directory, that imports `virtual:form-validation/<id>`. Every build failed:
// the module had a TypeScript type export (Vite does not transpile virtual
// ids), and its `zod` import was resolved from the root, which has no
// node_modules.
describe('vite-plugin-jsonschema in a Vite build', () => {
    it('bundles the virtual schema from a root without node_modules', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'jsonschema-plugin-'));
        try {
            const entry = join(dir, 'entry.js');
            writeFileSync(entry, "export { formSchema } from 'virtual:form-validation/f1';\n");
            const result = await build({
                root: dir,
                configFile: false,
                logLevel: 'silent',
                plugins: [
                    jsonSchemaPlugin({
                        schemas: [
                            {
                                id: 'f1',
                                schema: {
                                    type: 'object',
                                    properties: { email: { type: 'string', format: 'email' } },
                                    required: ['email'],
                                },
                            },
                        ],
                    }),
                ],
                build: {
                    write: false,
                    lib: { entry, formats: ['es'], fileName: 'out' },
                    minify: false,
                },
            });
            const output = (Array.isArray(result) ? result[0] : result) as {
                output: Array<{ type: string; code?: string }>;
            };
            const code = output.output.find((o) => o.type === 'chunk')!.code!;
            // zod is bundled (not left as an unresolved import) and the schema exported.
            expect(code.includes('from "zod"')).toBe(false);
            expect(code.includes('.email("Please enter a valid email address")')).toBe(true);
            expect(/export \{[^}]*formSchema/.test(code)).toBe(true);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }, 30_000);
});
