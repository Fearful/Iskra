import { BaseStorageAdapter, type PutOptions, type StorageConfig, type StorageFile } from '../base';
import path from 'node:path';
import fs from 'node:fs/promises';

export class LocalStorageAdapter extends BaseStorageAdapter {
    private basePath: string;

    constructor(config: StorageConfig) {
        super();
        this.basePath = config.basePath || './storage';
    }

    async connect(): Promise<void> {
        await fs.mkdir(this.basePath, { recursive: true });
        this.connected = true;
    }

    async disconnect(): Promise<void> {
        this.connected = false;
    }

    private resolveWithinBase(filePath: string): string {
        const sanitizedPath = this.sanitizePath(filePath);
        const base = path.resolve(this.basePath);
        const resolved = path.resolve(base, sanitizedPath);
        if (resolved !== base && !resolved.startsWith(base + path.sep)) {
            throw new Error(`Path escapes storage root: ${filePath}`);
        }
        return resolved;
    }

    async put(filePath: string, data: Uint8Array | Buffer, options?: PutOptions): Promise<StorageFile> {
        this.ensureConnected();

        const sanitizedPath = this.sanitizePath(filePath);
        const fullPath = this.resolveWithinBase(filePath);

        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, data);

        const stat = await fs.stat(fullPath);

        return {
            name: path.basename(sanitizedPath),
            path: sanitizedPath,
            size: stat.size,
            mimeType: options?.contentType || this.getMimeType(sanitizedPath),
            lastModified: stat.mtime,
            url: await this.url(sanitizedPath),
        };
    }

    async get(filePath: string): Promise<Uint8Array | null> {
        this.ensureConnected();
        const fullPath = this.resolveWithinBase(filePath);

        try {
            return await fs.readFile(fullPath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw error;
        }
    }

    async getStream(filePath: string): Promise<ReadableStream | null> {
        this.ensureConnected();
        const fullPath = this.resolveWithinBase(filePath);

        try {
            await fs.access(fullPath);
        } catch {
            return null;
        }

        return Bun.file(fullPath).stream();
    }

    async delete(filePath: string): Promise<void> {
        this.ensureConnected();
        const fullPath = this.resolveWithinBase(filePath);

        try {
            await fs.unlink(fullPath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
    }

    async exists(filePath: string): Promise<boolean> {
        this.ensureConnected();
        let fullPath: string;
        try {
            fullPath = this.resolveWithinBase(filePath);
        } catch {
            return false;
        }
        try {
            await fs.access(fullPath);
            return true;
        } catch {
            return false;
        }
    }

    async isDirectory(filePath: string): Promise<boolean> {
        this.ensureConnected();
        let fullPath: string;
        try {
            fullPath = this.resolveWithinBase(filePath);
        } catch {
            return false;
        }
        try {
            const stat = await fs.stat(fullPath);
            return stat.isDirectory();
        } catch {
            return false;
        }
    }

    async list(prefix?: string): Promise<StorageFile[]> {
        this.ensureConnected();
        const searchPath = prefix ? path.join(this.basePath, this.sanitizePath(prefix)) : this.basePath;
        const files: StorageFile[] = [];

        const walk = async (dir: string): Promise<void> => {
            try {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        await walk(fullPath);
                    } else {
                        const relativePath = path.relative(this.basePath, fullPath);
                        const stat = await fs.stat(fullPath);
                        files.push({
                            name: entry.name,
                            path: this.sanitizePath(relativePath),
                            size: stat.size,
                            mimeType: this.getMimeType(entry.name),
                            lastModified: stat.mtime,
                            url: await this.url(this.sanitizePath(relativePath)),
                        });
                    }
                }
            } catch (e) {
                if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
            }
        };

        await walk(searchPath);
        return files;
    }

    async url(filePath: string, _expiresIn?: number): Promise<string> {
        const sanitizedPath = this.sanitizePath(filePath);
        return `/storage/${sanitizedPath}`;
    }
}
