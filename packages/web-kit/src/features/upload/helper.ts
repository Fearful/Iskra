import { contentTypeFor, type BaseStorageAdapter, type PutOptions } from '@iskra-bun/storage-kit';
import { ErrorCodes } from '@iskra-bun/core';
import { HttpError } from '../../errors';

/** `UploadConfig.maxFileSize` and `UploadLimits.maxFileSize` unless set: 10 MiB. */
export const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;

// Room for multipart boundaries and part headers on top of the file itself.
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * Refused unless `allowedExtensions` lists them: a browser runs these as a page
 * wherever they are served inline (e.g. by a static server for the local
 * adapter's folder), and a same-origin `.js` passes a `script-src 'self'` policy.
 */
export const ACTIVE_CONTENT_EXTENSIONS = new Set([
    '.html',
    '.htm',
    '.shtml',
    '.xhtml',
    '.xht',
    '.mht',
    '.mhtml',
    '.svg',
    '.svgz',
    '.xml',
    '.xsl',
    '.xslt',
    '.js',
    '.mjs',
    '.cjs',
]);

/** `.png` for `photo.PNG`; '' without an extension. */
function extensionOf(filename: string): string {
    const dot = filename.lastIndexOf('.');
    return dot === -1 ? '' : filename.slice(dot).toLowerCase();
}

/**
 * Whether `filename` may be stored: with `allowedExtensions` (lowercase), only
 * those; without, anything but {@link ACTIVE_CONTENT_EXTENSIONS}.
 */
export function extensionAllowed(filename: string, allowedExtensions: readonly string[]): boolean {
    if (allowedExtensions.length > 0) return allowedExtensions.some((e) => filename.toLowerCase().endsWith(e));
    return !ACTIVE_CONTENT_EXTENSIONS.has(extensionOf(filename));
}

/**
 * Parses a multipart body, aborting as soon as more than `limit` bytes arrive
 * instead of buffering an arbitrarily large request first. Returns null when
 * the limit is exceeded.
 */
export async function readFormDataWithin(req: Request, limit: number): Promise<FormData | null> {
    if (!req.body) return req.formData();
    let received = 0;
    let exceeded = false;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            received += chunk.byteLength;
            if (received > limit) {
                exceeded = true;
                controller.error(new Error('payload too large'));
            } else {
                controller.enqueue(chunk);
            }
        },
    });
    const limited = new Request(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body.pipeThrough(counter),
        duplex: 'half',
    } as RequestInit);
    try {
        return await limited.formData();
    } catch (err) {
        if (exceeded) return null;
        throw err;
    }
}

// Defense-in-depth: reduce an attacker-controlled filename to a safe basename
// and strip it to an allowlisted charset so traversal segments ("../",
// "..\\", absolute paths) can never escape the project base path. storage-kit's
// sanitizePath remains the primary control; this is a second, independent gate.
export function safeBasename(filename: string): string {
    const base = filename.split(/[\\/]/).pop() || '';
    const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
    return cleaned.length > 0 ? cleaned : 'file';
}

/**
 * A subfolder as storage-kit stores it: without empty or dot-only segments
 * (`a//b/../c` is `a/b/c`), so `authorize` sees the folder that is written.
 */
export function normalizeFolder(subfolder: string | undefined): string | undefined {
    const segments = (subfolder ?? '').split(/[\\/]/).filter((s) => s !== '' && !/^\.+$/.test(s));
    return segments.length > 0 ? segments.join('/') : undefined;
}

export interface UploadOptions {
    metadata?: Record<string, string>;
    /** Default: from the filename's extension (the uploader's type is never used). */
    contentType?: string;
    /** `false` fails with storage-kit's `FileExistsError` instead of replacing a stored file. */
    overwrite?: boolean;
}

export interface UploadResult {
    path: string;
    filename: string;
    size: number;
    uploadedAt: Date;
}

/** What `uploadFromRequest()` accepts; `UploadFeature` passes its own config. */
export interface UploadLimits {
    /** Largest file, in bytes (default 10 MiB). */
    maxFileSize?: number;
    /** Only these extensions (default: anything but active content such as `.html`, `.svg`, `.js`). */
    allowedExtensions?: string[];
}

export class UploadHelper {
    private basePath: string;
    private maxFileSize: number;
    private allowedExtensions: string[];

    constructor(
        private storage: BaseStorageAdapter,
        private projectName: string,
        limits: UploadLimits = {},
    ) {
        this.basePath = `${projectName}/`;
        this.maxFileSize = limits.maxFileSize || DEFAULT_MAX_FILE_SIZE;
        this.allowedExtensions = (limits.allowedExtensions || []).map((e) => e.toLowerCase());
    }

    getBasePath(): string {
        return this.basePath;
    }

    /** The storage key of a file (or of the folder itself, without `filename`). */
    keyFor(filename: string | undefined, subfolder?: string): string {
        const folder = normalizeFolder(subfolder);
        const dir = folder ? `${this.basePath}${folder}` : this.basePath.slice(0, -1);
        return filename === undefined ? dir : `${dir}/${filename}`;
    }

    async upload(
        filename: string,
        data: Uint8Array | string,
        subfolder?: string,
        options?: UploadOptions,
    ): Promise<UploadResult> {
        const fullPath = this.keyFor(filename, subfolder);
        const fileData = typeof data === 'string' ? new TextEncoder().encode(data) : data;

        const putOptions: PutOptions | undefined = options
            ? {
                  contentType: options.contentType,
                  metadata: options.metadata,
                  overwrite: options.overwrite,
              }
            : undefined;

        await this.storage.put(fullPath, fileData, putOptions);

        return {
            path: fullPath,
            filename,
            size: fileData.length,
            uploadedAt: new Date(),
        };
    }

    /**
     * Stores the file of a multipart request's `fieldName`, with the upload
     * route's rules: the body is cut off past `maxFileSize` (HttpError 413,
     * 'File too large') and an extension it does not allow is refused
     * (HttpError 400, 'Invalid extension'). It used to read any body whole.
     */
    async uploadFromRequest(
        request: Request,
        fieldName: string,
        subfolder?: string,
        options?: UploadOptions,
    ): Promise<UploadResult> {
        const tooLarge = () => new HttpError(413, 'File too large', { code: ErrorCodes.BAD_REQUEST });
        const limit = this.maxFileSize + MULTIPART_OVERHEAD_BYTES;
        if (Number(request.headers.get('content-length')) > limit) throw tooLarge();
        let formData: FormData | null;
        try {
            formData = await readFormDataWithin(request, limit);
        } catch (err) {
            throw new HttpError(400, 'Invalid multipart body', { code: ErrorCodes.BAD_REQUEST, cause: err as Error });
        }
        if (!formData) throw tooLarge();

        const file = formData.get(fieldName);
        if (!file || !(file instanceof File)) throw new Error(`No file found in field: ${fieldName}`);
        if (file.size > this.maxFileSize) throw tooLarge();

        const safeName = safeBasename(file.name);
        if (!extensionAllowed(safeName, this.allowedExtensions)) {
            throw new HttpError(400, 'Invalid extension', { code: ErrorCodes.BAD_REQUEST });
        }

        const data = new Uint8Array(await file.arrayBuffer());
        // Not file.type: Bun derives it from the name, so `logo.svg` came in as
        // image/svg+xml and was stored as a page the browser runs.
        const opts = { ...options, contentType: options?.contentType || contentTypeFor(safeName) };
        return this.upload(safeName, data, subfolder, opts);
    }

    async list(subfolder?: string) {
        return await this.storage.list(this.keyFor(undefined, subfolder));
    }

    async get(filename: string, subfolder?: string) {
        return await this.storage.get(this.keyFor(filename, subfolder));
    }

    /** The file as a stream (null when missing): a download never holds the whole file in memory. */
    async getStream(filename: string, subfolder?: string) {
        return await this.storage.getStream(this.keyFor(filename, subfolder));
    }

    async delete(filename: string, subfolder?: string) {
        await this.storage.delete(this.keyFor(filename, subfolder));
    }

    async getUrl(filename: string, subfolder?: string, expiresIn?: number) {
        return await this.storage.url(this.keyFor(filename, subfolder), expiresIn);
    }
}
