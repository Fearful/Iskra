import { contentTypeFor } from './content-type';

export interface StorageConfig {
    adapter: 'local' | 'minio' | 's3';
    basePath?: string;
    connection?: {
        endpoint?: string;
        accessKey?: string;
        secretKey?: string;
        bucket?: string;
        region?: string;
        useSSL?: boolean;
    };
}

export interface StorageFile {
    name: string;
    path: string;
    size: number;
    mimeType?: string;
    lastModified?: Date;
    url?: string;
}

export interface PutOptions {
    /** Default: from the path's extension (see `contentTypeFor`). */
    contentType?: string;
    /**
     * `Content-Disposition` stored with the object (S3/MinIO). Default:
     * `inline` for raster images, `attachment` for anything else.
     */
    contentDisposition?: string;
    /**
     * `false` fails with {@link FileExistsError} instead of replacing a file
     * already stored at the path (S3 `If-None-Match: *`, an exclusive create
     * locally). Default: `true`.
     */
    overwrite?: boolean;
    metadata?: Record<string, string>;
    public?: boolean;
}

/** What a URL from `url()` serves (S3/MinIO; the local adapter's URLs are served by the app). */
export interface UrlOptions {
    /** Default: from the path's extension, whatever type the object was stored with. */
    contentType?: string;
    /** Default: `inline` for raster images, `attachment` for anything else. */
    contentDisposition?: string;
}

/** `put()` with `overwrite: false` found a file already stored at `path`. */
export class FileExistsError extends Error {
    readonly code = 'EEXIST';

    constructor(readonly path: string) {
        super(`File already exists: ${path}`);
        this.name = 'FileExistsError';
    }
}

export interface StorageAdapter {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    put(path: string, data: Uint8Array | Buffer | ReadableStream, options?: PutOptions): Promise<StorageFile>;
    get(path: string): Promise<Uint8Array | null>;
    getStream(path: string): Promise<ReadableStream | null>;
    delete(path: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    list(prefix?: string): Promise<StorageFile[]>;
    url(path: string, expiresIn?: number, options?: UrlOptions): Promise<string>;
    copy(from: string, to: string): Promise<void>;
    move(from: string, to: string): Promise<void>;
    isDirectory(path: string): Promise<boolean>;
}

export abstract class BaseStorageAdapter implements StorageAdapter {
    protected connected = false;

    abstract connect(): Promise<void>;
    abstract disconnect(): Promise<void>;
    abstract put(path: string, data: Uint8Array | Buffer | ReadableStream, options?: PutOptions): Promise<StorageFile>;
    abstract get(path: string): Promise<Uint8Array | null>;
    abstract getStream(path: string): Promise<ReadableStream | null>;
    abstract delete(path: string): Promise<void>;
    abstract exists(path: string): Promise<boolean>;
    abstract list(prefix?: string): Promise<StorageFile[]>;
    abstract url(path: string, expiresIn?: number, options?: UrlOptions): Promise<string>;
    abstract isDirectory(path: string): Promise<boolean>;

    isConnected(): boolean {
        return this.connected;
    }

    protected ensureConnected(): void {
        if (!this.connected) {
            throw new Error('Storage not connected. Call connect() first.');
        }
    }

    async copy(from: string, to: string): Promise<void> {
        const data = await this.get(from);
        if (!data) {
            throw new Error(`Source file not found: ${from}`);
        }
        await this.put(to, data);
    }

    async move(from: string, to: string): Promise<void> {
        // Onto itself: copying then deleting the source deleted the file.
        if (this.sanitizePath(from) === this.sanitizePath(to)) {
            if (!(await this.exists(from))) {
                throw new Error(`Source file not found: ${from}`);
            }
            return;
        }
        await this.copy(from, to);
        await this.delete(from);
    }

    protected generateFileName(originalName: string): string {
        const ext = originalName.split('.').pop();
        const timestamp = Date.now();
        const random = crypto.randomUUID().replace(/-/g, '');
        return `${timestamp}-${random}.${ext}`;
    }

    protected sanitizePath(path: string): string {
        const normalized = path.replace(/\\/g, '/');
        const segments = normalized.split('/').filter((segment) => segment !== '' && !/^\.+$/.test(segment));
        return segments.join('/');
    }

    protected getMimeType(filename: string): string {
        return contentTypeFor(filename);
    }
}
