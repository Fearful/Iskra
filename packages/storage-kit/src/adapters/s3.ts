import { BaseStorageAdapter } from "../base";
import type { StorageConfig, StorageFile, PutOptions } from "../base";
import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
    HeadBucketCommand,
    ListObjectsV2Command,
    CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export class S3StorageAdapter extends BaseStorageAdapter {
    private client: S3Client;
    private bucket: string;

    constructor(private config: StorageConfig) {
        super();
        const conn = config.connection || {};

        this.bucket = conn.bucket || "iskra-storage";

        this.client = new S3Client({
            endpoint: conn.endpoint,
            region: conn.region || "us-east-1",
            credentials:
                conn.accessKey && conn.secretKey
                    ? { accessKeyId: conn.accessKey, secretAccessKey: conn.secretKey }
                    : undefined,
            forcePathStyle: !!conn.endpoint,
        });
    }

    async connect(): Promise<void> {
        try {
            await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
            this.connected = true;
        } catch (err: any) {
            throw new Error(`Failed to connect to S3 bucket "${this.bucket}": ${err.message}`);
        }
    }

    async disconnect(): Promise<void> {
        this.client.destroy();
        this.connected = false;
    }

    async put(
        path: string,
        data: Uint8Array | Buffer | ReadableStream,
        options?: PutOptions
    ): Promise<StorageFile> {
        this.ensureConnected();
        const key = this.sanitizePath(path);

        let body: Uint8Array | Buffer;
        if (data instanceof ReadableStream) {
            const response = new Response(data);
            body = new Uint8Array(await response.arrayBuffer());
        } else {
            body = data;
        }

        await this.client.send(
            new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: body,
                ContentType: options?.contentType || this.getMimeType(key),
                Metadata: options?.metadata,
            })
        );

        return {
            name: key.split("/").pop() || key,
            path: key,
            size: body.length,
            mimeType: options?.contentType || this.getMimeType(key),
            lastModified: new Date(),
        };
    }

    async get(path: string): Promise<Uint8Array | null> {
        this.ensureConnected();
        const key = this.sanitizePath(path);

        try {
            const response = await this.client.send(
                new GetObjectCommand({ Bucket: this.bucket, Key: key })
            );

            if (!response.Body) return null;
            return new Uint8Array(await response.Body.transformToByteArray());
        } catch (err: any) {
            if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
                return null;
            }
            throw err;
        }
    }

    async getStream(path: string): Promise<ReadableStream | null> {
        this.ensureConnected();
        const key = this.sanitizePath(path);

        try {
            const response = await this.client.send(
                new GetObjectCommand({ Bucket: this.bucket, Key: key })
            );

            if (!response.Body) return null;

            if (typeof (response.Body as any).transformToWebStream === "function") {
                return (response.Body as any).transformToWebStream();
            }

            // Fallback: buffer then wrap in a ReadableStream
            const bytes = await response.Body.transformToByteArray();
            return new ReadableStream({
                start(controller) {
                    controller.enqueue(bytes);
                    controller.close();
                },
            });
        } catch (err: any) {
            if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
                return null;
            }
            throw err;
        }
    }

    async delete(path: string): Promise<void> {
        this.ensureConnected();
        const key = this.sanitizePath(path);

        await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    }

    async exists(path: string): Promise<boolean> {
        this.ensureConnected();
        const key = this.sanitizePath(path);

        try {
            await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
            return true;
        } catch (err: any) {
            if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
                return false;
            }
            throw err;
        }
    }

    async list(prefix?: string): Promise<StorageFile[]> {
        this.ensureConnected();
        const files: StorageFile[] = [];
        let continuationToken: string | undefined;

        do {
            const response = await this.client.send(
                new ListObjectsV2Command({
                    Bucket: this.bucket,
                    Prefix: prefix ? this.sanitizePath(prefix) : undefined,
                    ContinuationToken: continuationToken,
                })
            );

            if (response.Contents) {
                for (const obj of response.Contents) {
                    if (!obj.Key) continue;
                    files.push({
                        name: obj.Key.split("/").pop() || obj.Key,
                        path: obj.Key,
                        size: obj.Size || 0,
                        mimeType: this.getMimeType(obj.Key),
                        lastModified: obj.LastModified,
                    });
                }
            }

            continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
        } while (continuationToken);

        return files;
    }

    async url(path: string, expiresIn: number = 3600): Promise<string> {
        this.ensureConnected();
        const key = this.sanitizePath(path);

        const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
        return await getSignedUrl(this.client, command, { expiresIn });
    }

    async copy(from: string, to: string): Promise<void> {
        this.ensureConnected();
        const sourceKey = this.sanitizePath(from);
        const destKey = this.sanitizePath(to);

        await this.client.send(
            new CopyObjectCommand({
                Bucket: this.bucket,
                CopySource: `${this.bucket}/${sourceKey}`,
                Key: destKey,
            })
        );
    }

    async isDirectory(path: string): Promise<boolean> {
        this.ensureConnected();
        const prefix = this.sanitizePath(path).replace(/\/?$/, "/");

        const response = await this.client.send(
            new ListObjectsV2Command({
                Bucket: this.bucket,
                Prefix: prefix,
                MaxKeys: 1,
            })
        );

        return (response.Contents?.length || 0) > 0;
    }
}
