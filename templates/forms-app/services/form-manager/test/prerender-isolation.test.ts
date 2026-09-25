import { afterAll, afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forms, spaces } from '@forms-app/shared/db';
import { config } from '../src/app.config.ts';
import { buildFormBundle, PrerenderService } from '../src/domain/prerender/prerender.service.ts';
import { generateFormHtml } from '../src/domain/prerender/html-template.ts';
import { generateFormRuntime, publicFormBase } from '../src/domain/prerender/form-runtime.ts';

// The pre-render built in the fixed, shared /tmp/form-builds/<formId>, and Vite
// searched the build directory's parents for a PostCSS config (which it runs)
// and a tsconfig.json: another user of the machine could run code in
// form-manager or put JavaScript into every public form page.

const SCHEMA = { type: 'object', properties: { email: { type: 'string', format: 'email' } }, required: ['email'] };
const FIELD = {
    id: 'f1',
    formId: 'form-1',
    fieldType: 'email',
    label: 'Email',
    name: 'email',
    position: 0,
    required: true,
    options: null,
    maxLength: null,
    min: null,
    max: null,
    placeholder: null,
    helpText: null,
    errorMessage: null,
};

/** A directory with what an attacker would leave in the shared temp directory; `ran` exists once the PostCSS config ran. */
function plantConfigs(dir: string) {
    const ran = join(dir, 'postcss-config-ran');
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(
        join(dir, 'postcss.config.cjs'),
        `require('fs').writeFileSync(${JSON.stringify(ran)}, 'ran');\nmodule.exports = { plugins: [] };\n`,
    );
    writeFileSync(join(dir, 'tsconfig.json'), '{ "compilerOptions": { not json');
    return ran;
}

describe('buildFormBundle', () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'form-build-parent-'));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('reads no PostCSS config or tsconfig.json around the build directory', async () => {
        const ran = plantConfigs(dir);
        const src = join(dir, 'src');
        mkdirSync(join(src, 'assets'), { recursive: true });
        writeFileSync(join(src, 'index.html'), generateFormHtml('Encuesta', null, [FIELD] as any, 'form-1', 'key'));
        writeFileSync(join(src, 'main.ts'), generateFormRuntime('form-1', 'demo', 'encuesta', 'key'));
        writeFileSync(join(src, 'assets', 'style.css'), 'body { margin: 0 }');

        await buildFormBundle({
            sourceDir: src,
            outputDir: join(dir, 'out'),
            formId: 'form-1',
            validationSchema: SCHEMA,
            base: publicFormBase('demo', 'encuesta'),
        });

        expect(existsSync(ran)).toBe(false);
        expect(readFileSync(join(dir, 'out', 'index.html'), 'utf8')).toContain('/formularios/demo/encuesta/assets/');
    }, 60_000);
});

describe('PrerenderService.prerenderForm', () => {
    const root = mkdtempSync(join(tmpdir(), 'form-manager-tmp-'));
    const env = { TMPDIR: process.env.TMPDIR };
    const staticDir = config.staticDir;
    let schema: unknown = SCHEMA;
    let buildDirs: { name: string; mode: number }[] = [];

    /** A Drizzle-ish db with one form, its space and its field. */
    const db = {
        select: () => ({
            from: (table: unknown) => ({
                where: () => {
                    const rows =
                        table === forms
                            ? [
                                  {
                                      id: 'form-1',
                                      spaceId: 's1',
                                      title: 'Encuesta',
                                      slug: 'encuesta',
                                      validationSchema: schema,
                                  },
                              ]
                            : table === spaces
                              ? [{ id: 's1', slug: 'demo' }]
                              : [FIELD];
                    return Object.assign(Promise.resolve(rows), { orderBy: async () => rows });
                },
            }),
        }),
    };
    // Redis is written after the build: the build directories that exist then.
    const redis = {
        set: async () => {
            buildDirs = readdirSync(join(root, 'tmp'))
                .filter((name) => name.startsWith('form-build-'))
                .map((name) => ({ name, mode: statSync(join(root, 'tmp', name)).mode & 0o777 }));
        },
        sadd: async () => {},
    };

    beforeEach(() => {
        mkdirSync(join(root, 'tmp'), { recursive: true });
        // The temp directory as another user would leave it.
        plantConfigs(join(root, 'tmp'));
        process.env.TMPDIR = join(root, 'tmp');
        config.staticDir = join(root, 'static');
        PrerenderService.setDb(db);
        PrerenderService.setRedis(redis);
        spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        if (env.TMPDIR === undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR = env.TMPDIR;
        config.staticDir = staticDir;
        schema = SCHEMA;
        buildDirs = [];
        (console.log as unknown as { mockRestore(): void }).mockRestore();
        rmSync(join(root, 'tmp'), { recursive: true, force: true });
    });

    afterAll(() => rmSync(root, { recursive: true, force: true }));

    it('builds in a private directory of its own, and removes it', async () => {
        const { outputDir } = await PrerenderService.prerenderForm('form-1');

        expect(buildDirs).toHaveLength(1);
        expect(buildDirs[0].mode).toBe(0o700);
        expect(existsSync(join(root, 'tmp', buildDirs[0].name))).toBe(false);
        expect(existsSync(join(root, 'tmp', 'postcss-config-ran'))).toBe(false);
        expect(existsSync(join(outputDir, 'index.html'))).toBe(true);
    }, 60_000);

    it('removes the build directory when the build fails', async () => {
        // The validation plugin refuses a maxLength that is not a number.
        schema = { type: 'object', properties: { a: { type: 'string', maxLength: 'x' } } };
        await expect(PrerenderService.prerenderForm('form-1')).rejects.toThrow();
        expect(readdirSync(join(root, 'tmp')).filter((name) => name.startsWith('form-build-'))).toEqual([]);
    }, 60_000);
});
