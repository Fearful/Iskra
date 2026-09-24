import type { StorageFeature } from "../storage";
import type { BaseStorageAdapter, PutOptions } from "@iskra-bun/storage-kit";

export interface UploadOptions {
    metadata?: Record<string, string>;
    contentType?: string;
}

export interface UploadResult {
    path: string;
    filename: string;
    size: number;
    uploadedAt: Date;
}

export class UploadHelper {
    private basePath: string;

    constructor(private storage: BaseStorageAdapter, private projectName: string) {
        this.basePath = `${projectName}/`;
    }

    getBasePath(): string {
        return this.basePath;
    }

    // Defense-in-depth: reduce an attacker-controlled filename to a safe basename
    // and strip it to an allowlisted charset so traversal segments ("../",
    // "..\\", absolute paths) can never escape the project base path. storage-kit's
    // sanitizePath remains the primary control; this is a second, independent gate.
    private safeBasename(filename: string): string {
        const base = filename.split(/[\\/]/).pop() || "";
        const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "");
        return cleaned.length > 0 ? cleaned : "file";
    }

    private buildPath(filename: string, subfolder?: string): string {
        if (subfolder) {
            const normalized = subfolder.replace(/^\/+|\/+$/g, "");
            return `${this.basePath}${normalized}/${filename}`;
        }
        return `${this.basePath}${filename}`;
    }

    async upload(filename: string, data: Uint8Array | string, subfolder?: string, options?: UploadOptions): Promise<UploadResult> {
        const fullPath = this.buildPath(filename, subfolder);
        const fileData = typeof data === "string" ? new TextEncoder().encode(data) : data;

        const putOptions: PutOptions | undefined = options ? {
            contentType: options.contentType,
            metadata: options.metadata
        } : undefined;

        await this.storage.put(fullPath, fileData, putOptions);

        return {
            path: fullPath,
            filename,
            size: fileData.length,
            uploadedAt: new Date()
        };
    }

    // uploadFromRequest: Not implementing raw request reading here to avoid Node/Bun specific request stream issues unless necessary
    // or implementing simplified Version
    async uploadFromRequest(request: Request, fieldName: string, subfolder?: string, options?: UploadOptions): Promise<UploadResult> {
        const formData = await request.formData();
        const file = formData.get(fieldName);
        if (!file || !(file instanceof File)) throw new Error(`No file found in field: ${fieldName}`);

        const data = new Uint8Array(await file.arrayBuffer());
        const opts = { ...options, contentType: options?.contentType || file.type };
        const safeName = this.safeBasename(file.name);
        return this.upload(safeName, data, subfolder, opts);
    }

    async list(subfolder?: string) {
        const prefix = subfolder ? `${this.basePath}${subfolder.replace(/^\/+|\/+$/g, "")}/` : this.basePath;
        return await this.storage.list(prefix);
    }

    async get(filename: string, subfolder?: string) {
        const fullPath = this.buildPath(filename, subfolder);
        return await this.storage.get(fullPath);
    }

    async delete(filename: string, subfolder?: string) {
        const fullPath = this.buildPath(filename, subfolder);
        await this.storage.delete(fullPath);
    }

    async getUrl(filename: string, subfolder?: string, expiresIn?: number) {
        const fullPath = this.buildPath(filename, subfolder);
        return await this.storage.url(fullPath, expiresIn);
    }
}
