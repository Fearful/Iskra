export interface StorageConfig {
    adapter: "local" | "minio" | "s3";
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
    contentType?: string;
    metadata?: Record<string, string>;
    public?: boolean;
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
    url(path: string, expiresIn?: number): Promise<string>;
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
    abstract url(path: string, expiresIn?: number): Promise<string>;
    abstract isDirectory(path: string): Promise<boolean>;

    isConnected(): boolean {
        return this.connected;
    }

    protected ensureConnected(): void {
        if (!this.connected) {
            throw new Error("Storage not connected. Call connect() first.");
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
        const ext = originalName.split(".").pop();
        const timestamp = Date.now();
        const random = crypto.randomUUID().replace(/-/g, "");
        return `${timestamp}-${random}.${ext}`;
    }

    protected sanitizePath(path: string): string {
        const normalized = path.replace(/\\/g, "/");
        const segments = normalized
            .split("/")
            .filter((segment) => segment !== "" && !/^\.+$/.test(segment));
        return segments.join("/");
    }

    protected getMimeType(filename: string): string {
        const ext = filename.split(".").pop()?.toLowerCase();
        const mimeTypes: Record<string, string> = {
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            png: "image/png",
            gif: "image/gif",
            pdf: "application/pdf",
            txt: "text/plain",
            json: "application/json",
            zip: "application/zip",
        };
        return mimeTypes[ext || ""] || "application/octet-stream";
    }
}
