import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { build } from 'vite';
import jsonSchemaPlugin from '@forms-app/vite-plugin-jsonschema';
import { forms, formFields, spaces } from '@forms-app/shared/db';
import { eq } from 'drizzle-orm';
import { generateFormHtml } from './html-template.ts';
import { generateFormRuntime, publicFormBase } from './form-runtime.ts';
import { config } from '../../app.config.ts';
import { REDIS_KEYS } from '@forms-app/shared';

/**
 * Builds a form page (index.html + main.ts in `sourceDir`) into `outputDir`.
 * `base` is the page's public URL path: the built HTML references its assets
 * under it (with the default "/" they pointed at /assets/*, which nothing
 * serves, so published forms loaded without their script and styles).
 */
export async function buildFormBundle(opts: {
    sourceDir: string;
    outputDir: string;
    formId: string;
    validationSchema: any;
    base: string;
}): Promise<void> {
    await build({
        root: opts.sourceDir,
        base: opts.base,
        configFile: false,
        plugins: [
            jsonSchemaPlugin({
                schemas: [{ id: opts.formId, schema: opts.validationSchema }],
            }),
        ],
        build: {
            outDir: opts.outputDir,
            emptyOutDir: true,
            rollupOptions: {
                input: join(opts.sourceDir, 'index.html'),
            },
        },
        logLevel: 'warn',
    });
}

export class PrerenderService {
    private static db: any;
    private static redis: any;

    static setDb(db: any) {
        this.db = db;
    }

    static setRedis(redis: any) {
        this.redis = redis;
    }

    static async prerenderForm(formId: string): Promise<{ outputDir: string }> {
        // 1. Load form + fields + space from DB
        const formResults = await this.db.select().from(forms).where(eq(forms.id, formId));
        const form = formResults[0];
        if (!form) throw new Error(`Form not found: ${formId}`);

        const spaceResults = await this.db.select().from(spaces).where(eq(spaces.id, form.spaceId));
        const space = spaceResults[0];
        if (!space) throw new Error(`Space not found: ${form.spaceId}`);

        const fields = await this.db
            .select()
            .from(formFields)
            .where(eq(formFields.formId, formId))
            .orderBy(formFields.position);

        const validationSchema = form.validationSchema as any;
        if (!validationSchema) throw new Error('Form has no validation schema');

        const recaptchaSiteKey = process.env.RECAPTCHA_SITE_KEY || 'your-site-key';

        // 2. Create temp build directory
        const tmpDir = join('/tmp', 'form-builds', formId);
        mkdirSync(tmpDir, { recursive: true });

        // 3. Generate source files
        const htmlContent = generateFormHtml(
            form.title,
            form.description,
            fields,
            formId,
            recaptchaSiteKey,
        );
        writeFileSync(join(tmpDir, 'index.html'), htmlContent);

        const runtimeContent = generateFormRuntime(formId, space.slug, form.slug, recaptchaSiteKey);
        writeFileSync(join(tmpDir, 'main.ts'), runtimeContent);

        // Basic CSS
        mkdirSync(join(tmpDir, 'assets'), { recursive: true });
        writeFileSync(join(tmpDir, 'assets', 'style.css'), DEFAULT_STYLES);

        // 4. Output directory
        const outputDir = join(config.staticDir, space.slug, form.slug);
        mkdirSync(outputDir, { recursive: true });

        // 5. Build with Vite
        await buildFormBundle({
            sourceDir: tmpDir,
            outputDir,
            formId,
            validationSchema,
            base: publicFormBase(space.slug, form.slug),
        });

        // 6. Write form schema to Redis (so forms-api has it immediately)
        if (this.redis) {
            const schemaKey = REDIS_KEYS.formSchema(space.slug, form.slug);
            const metaKey = REDIS_KEYS.formMeta(space.slug, form.slug);

            await this.redis.set(schemaKey, JSON.stringify(validationSchema));
            await this.redis.set(
                metaKey,
                JSON.stringify({
                    formId: form.id,
                    status: form.status,
                    startsAt: form.startsAt?.toISOString() ?? null,
                    endsAt: form.endsAt?.toISOString() ?? null,
                }),
            );
            await this.redis.sadd(REDIS_KEYS.formIndex, `${space.slug}:${form.slug}`);
        }

        // 7. Clean up temp dir
        rmSync(tmpDir, { recursive: true, force: true });

        console.log(`Prerendered form ${formId} to ${outputDir}`);
        return { outputDir };
    }
}

const DEFAULT_STYLES = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, -apple-system, sans-serif; background: #f5f5f5; color: #333; }
.form-container { max-width: 640px; margin: 2rem auto; padding: 2rem; background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
h1 { margin-bottom: 0.5rem; font-size: 1.5rem; }
.description { margin-bottom: 1.5rem; color: #666; }
.form-field { margin-bottom: 1.25rem; }
.form-field label { display: block; margin-bottom: 0.375rem; font-weight: 500; font-size: 0.9rem; }
.form-field input, .form-field select, .form-field textarea {
    width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #d1d5db; border-radius: 6px;
    font-size: 0.9rem; transition: border-color 0.15s;
}
.form-field input:focus, .form-field select:focus, .form-field textarea:focus {
    outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.1);
}
.form-field textarea { min-height: 100px; resize: vertical; }
.field-error { border-color: #dc2626 !important; }
.error-message { display: none; color: #dc2626; font-size: 0.8rem; margin-top: 0.25rem; }
.help-text { display: block; color: #6b7280; font-size: 0.8rem; margin-top: 0.25rem; }
.required { color: #dc2626; }
.radio-group, .checkbox-group { display: flex; flex-direction: column; gap: 0.5rem; }
.radio-group label, .checkbox-group label { display: flex; align-items: center; gap: 0.5rem; font-weight: normal; cursor: pointer; }
.form-actions { margin-top: 1.5rem; }
.form-actions button {
    width: 100%; padding: 0.75rem; background: #2563eb; color: white; border: none;
    border-radius: 6px; font-size: 1rem; font-weight: 500; cursor: pointer; transition: background 0.15s;
}
.form-actions button:hover { background: #1d4ed8; }
.form-actions button:disabled { background: #93c5fd; cursor: not-allowed; }
.form-status { margin-top: 1rem; padding: 0.75rem; border-radius: 6px; font-size: 0.9rem; }
.form-status.success { background: #dcfce7; color: #166534; }
.form-status.error { background: #fee2e2; color: #991b1b; }
`;
