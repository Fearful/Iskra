import { constants } from 'node:buffer';
import { BaseStorageAdapter, FileExistsError } from '../base';
import type { StorageConfig, StorageFile, PutOptions, UrlOptions } from '../base';
import { dispositionFor } from '../content-type';
import type { S3Client } from '@aws-sdk/client-s3';

type S3Sdk = typeof import('@aws-sdk/client-s3');
type Presigner = typeof import('@aws-sdk/s3-request-presigner');

/**
 * The AWS SDK is loaded when the first S3 adapter is created, not when this
 * module is imported: the package index re-exports this class, so a static
 * import loaded the SDK (~190 ms, and its memory) into every app importing
 * storage-kit or web-kit, even ones that only store files locally.
 */
let sdk: S3Sdk | undefined;

/**
 * Default `maxBytes` of a streamed put: S3's limit for a single PutObject, or
 * the largest Buffer this runtime can allocate when that is smaller.
 */
const DEFAULT_MAX_STREAM_BYTES = Math.min(5 * 1024 ** 3, constants.MAX_LENGTH);

/** `maxBytes` as given, checked: a non-negative whole number of bytes. */
function checkMaxBytes(maxBytes: unknown): number {
    if (typeof maxBytes !== 'number') throw new TypeError('put(): maxBytes must be a number');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
        throw new RangeError(`put(): maxBytes must be a non-negative integer, got ${maxBytes}`);
    }
    return maxBytes;
}

/** A stream chunk as bytes: strings are UTF-8, views keep only their own range. */
function toBytes(value: unknown): Uint8Array {
    if (typeof value === 'string') return Buffer.from(value, 'utf8');
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw new TypeError('put(): stream chunks must be strings, ArrayBuffers or ArrayBuffer views');
}

/**
 * Reads a stream to put, up to `maxBytes`: past it the stream is cancelled
 * (so its source stops producing) instead of filling memory.
 */
async function readStream(stream: ReadableStream, maxBytes: number): Promise<Buffer> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            // Counted once converted, so a string counts its UTF-8 bytes.
            const chunk = toBytes(value);
            size += chunk.byteLength;
            if (size > maxBytes) throw new RangeError(`put(): stream exceeds maxBytes (${maxBytes})`);
            chunks.push(chunk);
        }
    } catch (err) {
        await reader.cancel().catch(() => {});
        throw err;
    } finally {
        reader.releaseLock();
    }
    return Buffer.concat(chunks, size);
}

function loadSdk(): S3Sdk {
    // Synchronous on purpose: the constructor builds the client.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (sdk ??= require('@aws-sdk/client-s3') as S3Sdk);
}

/** An SDK error for a missing object: its `name`, or a bare 404 (HEAD has no error body). */
function isMissing(err: unknown, name: string): boolean {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
    return e?.name === name || e?.$metadata?.httpStatusCode === 404;
}

/** A refused `If-None-Match: *` put: 412 when the key exists, 409 while another conditional put of it runs. */
function isConflict(err: unknown): boolean {
    const status = (err as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
    return status === 412 || status === 409;
}

/**
 * The endpoint's protocol as the SDK reads it: `http:/minio`, `http:minio` and
 * `http:\\minio` are plaintext too, which a check of the text for `http://`
 * let through.
 */
function endpointProtocol(endpoint: string): string {
    try {
        return new URL(endpoint).protocol;
    } catch {
        throw new Error('Invalid S3 endpoint: expected an http:// or https:// URL');
    }
}

export class S3StorageAdapter extends BaseStorageAdapter {
    private client: S3Client;
    private bucket: string;
    private sdk: S3Sdk;

    constructor(private config: StorageConfig) {
        super();
        const conn = config.connection || {};

        if (conn.endpoint) {
            const protocol = endpointProtocol(conn.endpoint);
            if (protocol === 'http:' && conn.useSSL !== false) {
                throw new Error('Refusing plaintext S3 endpoint; set useSSL:false to override');
            }
            if (protocol !== 'http:' && protocol !== 'https:') {
                throw new Error('Invalid S3 endpoint: expected an http:// or https:// URL');
            }
        }

        this.bucket = conn.bucket || 'iskra-storage';

        this.sdk = loadSdk();
        this.client = new this.sdk.S3Client({
            endpoint: conn.endpoint,
            region: conn.region || 'us-east-1',
            credentials:
                conn.accessKey && conn.secretKey
                    ? { accessKeyId: conn.accessKey, secretAccessKey: conn.secretKey }
                    : undefined,
            forcePathStyle: !!conn.endpoint,
        });
    }

    async connect(): Promise<void> {
        try {
            await this.client.send(new this.sdk.HeadBucketCommand({ Bucket: this.bucket }));
            this.connected = true;
        } catch (err) {
            throw new Error(
                `Failed to connect to S3 bucket "${this.bucket}": ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    async disconnect(): Promise<void> {
        this.client.destroy();
        this.connected = false;
    }

    async put(path: string, data: Uint8Array | Buffer | ReadableStream, options?: PutOptions): Promise<StorageFile> {
        this.ensureConnected();
        const key = this.sanitizePath(path);

        const body =
            data instanceof ReadableStream
                ? await readStream(
                      data,
                      options?.maxBytes === undefined ? DEFAULT_MAX_STREAM_BYTES : checkMaxBytes(options.maxBytes),
                  )
                : data;

        const contentType = options?.contentType || this.getMimeType(key);
        try {
            await this.client.send(
                new this.sdk.PutObjectCommand({
                    Bucket: this.bucket,
                    Key: key,
                    Body: body,
                    ContentType: contentType,
                    // Stored with the object, so any GET of it (public, CDN,
                    // presigned) downloads what a browser would run as a page.
                    ContentDisposition: options?.contentDisposition ?? dispositionFor(contentType),
                    Metadata: options?.metadata,
                    IfNoneMatch: options?.overwrite === false ? '*' : undefined,
                }),
            );
        } catch (err) {
            if (options?.overwrite === false && isConflict(err)) throw new FileExistsError(key);
            throw err;
        }

        return {
            name: key.split('/').pop() || key,
            path: key,
            size: body.length,
            mimeType: contentType,
            lastModified: new Date(),
        };
    }

    async get(path: string): Promise<Uint8Array | null> {
        this.ensureConnected();
        const key = this.sanitizePath(path);

        try {
            const response = await this.client.send(new this.sdk.GetObjectCommand({ Bucket: this.bucket, Key: key }));

            if (!response.Body) return null;
            return new Uint8Array(await response.Body.transformToByteArray());
        } catch (err) {
            if (isMissing(err, 'NoSuchKey')) {
                return null;
            }
            throw err;
        }
    }

    async getStream(path: string): Promise<ReadableStream | null> {
        this.ensureConnected();
        const key = this.sanitizePath(path);

        try {
            const response = await this.client.send(new this.sdk.GetObjectCommand({ Bucket: this.bucket, Key: key }));

            if (!response.Body) return null;

            if (typeof response.Body.transformToWebStream === 'function') {
                return response.Body.transformToWebStream() as ReadableStream;
            }

            // Fallback: buffer then wrap in a ReadableStream
            const bytes = await response.Body.transformToByteArray();
            return new ReadableStream({
                start(controller) {
                    controller.enqueue(bytes);
                    controller.close();
                },
            });
        } catch (err) {
            if (isMissing(err, 'NoSuchKey')) {
                return null;
            }
            throw err;
        }
    }

    async delete(path: string): Promise<void> {
        this.ensureConnected();
        const key = this.sanitizePath(path);

        await this.client.send(new this.sdk.DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    }

    async exists(path: string): Promise<boolean> {
        this.ensureConnected();
        const key = this.sanitizePath(path);

        try {
            await this.client.send(new this.sdk.HeadObjectCommand({ Bucket: this.bucket, Key: key }));
            return true;
        } catch (err) {
            if (isMissing(err, 'NotFound')) {
                return false;
            }
            throw err;
        }
    }

    async list(prefix?: string): Promise<StorageFile[]> {
        this.ensureConnected();
        const files: StorageFile[] = [];
        let continuationToken: string | undefined;
        // A folder, as with the local adapter: "acme" must not also match
        // "acme-internal/" (sanitizePath drops the trailing slash).
        const folder = prefix ? this.sanitizePath(prefix) : '';

        do {
            const response = await this.client.send(
                new this.sdk.ListObjectsV2Command({
                    Bucket: this.bucket,
                    Prefix: folder ? `${folder}/` : undefined,
                    ContinuationToken: continuationToken,
                }),
            );

            if (response.Contents) {
                for (const obj of response.Contents) {
                    if (!obj.Key) continue;
                    files.push({
                        name: obj.Key.split('/').pop() || obj.Key,
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

    async url(path: string, expiresIn: number = 3600, options: UrlOptions = {}): Promise<string> {
        this.ensureConnected();
        const key = this.sanitizePath(path);

        // Signed into the URL, whatever the object was stored with: an upload
        // stored as text/html or image/svg+xml would otherwise render inline.
        const contentType = options.contentType ?? this.getMimeType(key);
        const command = new this.sdk.GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
            ResponseContentType: contentType,
            ResponseContentDisposition: options.contentDisposition ?? dispositionFor(contentType),
        });
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded on first use, like the SDK
        const { getSignedUrl } = require('@aws-sdk/s3-request-presigner') as Presigner;
        return await getSignedUrl(this.client, command, { expiresIn });
    }

    async copy(from: string, to: string): Promise<void> {
        this.ensureConnected();
        const sourceKey = this.sanitizePath(from);
        const destKey = this.sanitizePath(to);

        await this.client.send(
            new this.sdk.CopyObjectCommand({
                Bucket: this.bucket,
                // URL-encoded, as S3 requires: "100%25 done.txt" or "café.txt"
                // otherwise copy the wrong object or fail.
                CopySource: `${this.bucket}/${sourceKey.split('/').map(encodeURIComponent).join('/')}`,
                Key: destKey,
            }),
        );
    }

    async isDirectory(path: string): Promise<boolean> {
        this.ensureConnected();
        const prefix = this.sanitizePath(path).replace(/\/?$/, '/');

        const response = await this.client.send(
            new this.sdk.ListObjectsV2Command({
                Bucket: this.bucket,
                Prefix: prefix,
                MaxKeys: 1,
            }),
        );

        return (response.Contents?.length || 0) > 0;
    }
}
