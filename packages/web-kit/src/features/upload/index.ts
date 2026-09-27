import type { Feature, UploadAction, UploadConfig, UploadTarget } from '../../types';
import type { Kernel } from '../../kernel';
import type { Hono, Context, Next } from 'hono';
import { FileExistsError, contentTypeFor, dispositionFor } from '@iskra-bun/storage-kit';
import {
    DEFAULT_MAX_FILE_SIZE,
    MULTIPART_OVERHEAD_BYTES,
    UploadHelper,
    extensionAllowed,
    normalizeFolder,
    readFormDataWithin,
    safeBasename,
} from './helper';
import { consoleLogger, type KernelLogger } from '../../logging';

declare module 'hono' {
    interface ContextVariableMap {
        upload: UploadHelper;
    }
}

export class UploadFeature implements Feature {
    name = 'upload';
    private log: KernelLogger = consoleLogger;
    dependencies = ['storage'];
    private helper?: UploadHelper;
    private config: Required<Omit<UploadConfig, 'authorize'>> & Pick<UploadConfig, 'authorize'>;

    constructor(config: UploadConfig) {
        if (config.exposeRoutes && !config.authorize) {
            // The routes can list, read, overwrite and delete every file of the
            // project; exposing them without a decision is never the safe default.
            throw new Error(
                'UploadFeature: exposeRoutes requires an `authorize(c, action)` callback ' +
                    '(pass `authorize: () => true` to make the upload routes public on purpose)',
            );
        }
        this.config = {
            projectName: config.projectName,
            maxFileSize: config.maxFileSize || DEFAULT_MAX_FILE_SIZE,
            allowedExtensions: (config.allowedExtensions || []).map((e) => e.toLowerCase()),
            overwrite: config.overwrite ?? false,
            exposeRoutes: config.exposeRoutes || false,
            routePrefix: config.routePrefix || '/upload',
            authorize: config.authorize,
        };
    }

    async initialize(kernel: Kernel): Promise<void> {
        this.log = kernel.getLogger();
        const storageFeature = kernel.getFeature('storage');
        if (!storageFeature) throw new Error('Upload feature requires storage feature');
        const storage = storageFeature.getAdapter();
        if (!storage) throw new Error('Storage adapter not ready');

        // Bun rejects a body above the Kernel's maxRequestBodySize (16 MiB by
        // default) with a bare 413 before any route runs, so a larger
        // maxFileSize would silently never be reachable.
        const bodyLimit = kernel.getConfig().maxRequestBodySize;
        if (
            this.config.exposeRoutes &&
            bodyLimit !== undefined &&
            this.config.maxFileSize + MULTIPART_OVERHEAD_BYTES > bodyLimit
        ) {
            throw new Error(
                `UploadFeature: maxFileSize (${this.config.maxFileSize} bytes) plus multipart overhead ` +
                    `(${MULTIPART_OVERHEAD_BYTES}) exceeds the Kernel's maxRequestBodySize (${bodyLimit}); ` +
                    `raise maxRequestBodySize in the Kernel/WebPlugin config or lower maxFileSize`,
            );
        }

        this.helper = new UploadHelper(storage, this.config.projectName, {
            maxFileSize: this.config.maxFileSize,
            allowedExtensions: this.config.allowedExtensions,
        });

        const app = kernel.getApp();
        app.use('*', async (c: Context, next: Next) => {
            c.set('upload', this.helper!);
            await next();
        });

        this.log.debug(`Upload feature initialized: ${this.config.projectName}`);
    }

    /** The file a download/delete URL names (`<prefix>/<subfolder...>/<filename>`). */
    private fileTarget(c: Context): UploadTarget & { filename: string } {
        const filePath = c.req.path.replace(`${this.config.routePrefix}/`, '');
        const segments = filePath.split('/');
        const filename = segments.pop() || '';
        const subfolder = normalizeFolder(segments.join('/'));
        return { key: this.helper!.keyFor(filename, subfolder), filename, subfolder };
    }

    routes(app: Hono) {
        if (!this.config.exposeRoutes) return;

        const prefix = this.config.routePrefix;
        const authorize = this.config.authorize!;
        const guard =
            (action: UploadAction, target?: (c: Context) => UploadTarget) => async (c: Context, next: Next) => {
                if (!(await authorize(c, action, target?.(c)))) return c.json({ error: 'Forbidden' }, 403);
                await next();
            };
        // Internal errors are logged, never echoed: storage errors can carry
        // paths, bucket names or credentials hints.
        const fail = (c: Context, action: UploadAction, e: unknown) => {
            this.log.error(`[upload] ${action} failed`, e);
            return c.json({ error: `${action[0].toUpperCase()}${action.slice(1)} failed` }, 500);
        };

        // POST — upload a file. `authorize` runs before the body is read, then
        // again with the resolved target before anything is written.
        app.post(`${prefix}`, guard('upload'), async (c) => {
            const upload = c.get('upload');
            const limit = this.config.maxFileSize + MULTIPART_OVERHEAD_BYTES;
            if (Number(c.req.header('content-length')) > limit) {
                return c.json({ error: 'File too large' }, 413);
            }
            let formData: FormData | null;
            try {
                formData = await readFormDataWithin(c.req.raw, limit);
            } catch {
                return c.json({ error: 'Invalid multipart body' }, 400);
            }
            if (!formData) return c.json({ error: 'File too large' }, 413);

            try {
                const file = formData.get('file');
                if (!file || !(file instanceof File)) return c.json({ error: 'No file' }, 400);

                if (file.size > this.config.maxFileSize) return c.json({ error: 'File too large' }, 413);
                const filename = safeBasename(file.name);
                if (!extensionAllowed(filename, this.config.allowedExtensions))
                    return c.json({ error: 'Invalid extension' }, 400);

                // The type comes from the extension, never from file.type (which
                // Bun derives from the name: image/svg+xml, text/html...).
                const subfolder = normalizeFolder(c.req.query('subfolder'));
                const type = contentTypeFor(filename);
                const target: UploadTarget = {
                    key: upload.keyFor(filename, subfolder),
                    filename,
                    subfolder,
                    size: file.size,
                    type,
                };
                if (!(await authorize(c, 'upload', target))) return c.json({ error: 'Forbidden' }, 403);

                const data = new Uint8Array(await file.arrayBuffer());
                const result = await upload.upload(filename, data, subfolder, {
                    contentType: type,
                    overwrite: this.config.overwrite,
                });
                return c.json({ success: true, ...result });
            } catch (e) {
                if (e instanceof FileExistsError) return c.json({ error: 'File already exists' }, 409);
                return fail(c, 'upload', e);
            }
        });

        // GET — list files
        const listTarget = (c: Context): UploadTarget => {
            const subfolder = normalizeFolder(c.req.query('subfolder'));
            return { key: this.helper!.keyFor(undefined, subfolder), subfolder };
        };
        app.get(`${prefix}`, guard('list', listTarget), async (c) => {
            const upload = c.get('upload');
            try {
                const files = await upload.list(listTarget(c).subfolder);
                return c.json({ success: true, files });
            } catch (e) {
                return fail(c, 'list', e);
            }
        });

        // GET — download a file, streamed from storage.
        app.get(`${prefix}/*`, guard('download', this.fileTarget.bind(this)), async (c) => {
            const upload = c.get('upload');
            try {
                const { filename, subfolder } = this.fileTarget(c);
                const stream = await upload.getStream(filename, subfolder);
                if (!stream) {
                    return c.json({ error: 'File not found' }, 404);
                }

                // Only raster images are shown inline; anything else (HTML,
                // SVG, PDF...) is a download, and sandboxed if rendered anyway.
                const contentType = contentTypeFor(filename);
                return new Response(stream, {
                    headers: {
                        'Content-Type': contentType,
                        'Content-Disposition': `${dispositionFor(contentType)}; filename="${safeBasename(filename)}"`,
                        'Content-Security-Policy': 'sandbox',
                    },
                });
            } catch (e) {
                return fail(c, 'download', e);
            }
        });

        // DELETE — delete a file
        app.delete(`${prefix}/*`, guard('delete', this.fileTarget.bind(this)), async (c) => {
            const upload = c.get('upload');
            try {
                const { filename, subfolder } = this.fileTarget(c);
                await upload.delete(filename, subfolder);
                return new Response(null, { status: 204 });
            } catch (e) {
                return fail(c, 'delete', e);
            }
        });
    }
}
