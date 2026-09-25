import { contentTypeFor, type BaseStorageAdapter, type PutOptions } from '@iskra-bun/storage-kit';

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

export class UploadHelper {
    private basePath: string;

    constructor(
        private storage: BaseStorageAdapter,
        private projectName: string,
    ) {
        this.basePath = `${projectName}/`;
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

    // uploadFromRequest: Not implementing raw request reading here to avoid Node/Bun specific request stream issues unless necessary
    // or implementing simplified Version
    async uploadFromRequest(
        request: Request,
        fieldName: string,
        subfolder?: string,
        options?: UploadOptions,
    ): Promise<UploadResult> {
        const formData = await request.formData();
        const file = formData.get(fieldName);
        if (!file || !(file instanceof File)) throw new Error(`No file found in field: ${fieldName}`);

        const data = new Uint8Array(await file.arrayBuffer());
        const safeName = safeBasename(file.name);
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
