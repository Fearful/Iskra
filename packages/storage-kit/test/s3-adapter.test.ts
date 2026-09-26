import { describe, expect, it } from 'bun:test';
import { S3StorageAdapter } from '../src/adapters/s3';

function makeAdapter() {
    return new S3StorageAdapter({
        adapter: 's3',
        connection: {
            region: 'us-east-1',
            bucket: 'test-bucket',
            accessKey: 'AKID',
            secretKey: 'secret',
        },
    });
}

function mockSend(adapter: S3StorageAdapter, handler: (cmd: any) => any) {
    (adapter as any).client.send = async (cmd: any) => handler(cmd);
}

describe('S3StorageAdapter - construction', () => {
    it('instantiates with S3 config', () => {
        const adapter = makeAdapter();
        expect(adapter).toBeDefined();
        expect(adapter.isConnected()).toBe(false);
    });

    it('instantiates with MinIO config (endpoint + forcePathStyle)', () => {
        const adapter = new S3StorageAdapter({
            adapter: 'minio',
            connection: {
                endpoint: 'http://localhost:9000',
                accessKey: 'minioadmin',
                secretKey: 'minioadmin',
                bucket: 'test-bucket',
                useSSL: false,
            },
        });
        expect(adapter).toBeDefined();
    });

    it('uses default bucket name when not specified', () => {
        const adapter = new S3StorageAdapter({
            adapter: 's3',
            connection: { accessKey: 'AKID', secretKey: 'secret' },
        });
        expect(adapter).toBeDefined();
    });
});

describe('S3StorageAdapter - not connected guard', () => {
    it('throws when get() is called without connect()', async () => {
        const adapter = makeAdapter();
        await expect(adapter.get('test.txt')).rejects.toThrow('not connected');
    });

    it('throws when put() is called without connect()', async () => {
        const adapter = makeAdapter();
        await expect(adapter.put('test.txt', new Uint8Array([1, 2, 3]))).rejects.toThrow('not connected');
    });

    it('throws when getStream() is called without connect()', async () => {
        const adapter = makeAdapter();
        await expect(adapter.getStream('test.txt')).rejects.toThrow('not connected');
    });
});

describe('S3StorageAdapter - connect failure', () => {
    it('throws with a descriptive message on invalid endpoint', async () => {
        const adapter = new S3StorageAdapter({
            adapter: 'minio',
            connection: {
                endpoint: 'http://localhost:19999',
                accessKey: 'fake',
                secretKey: 'fake',
                bucket: 'nonexistent',
                useSSL: false,
            },
        });
        await expect(adapter.connect()).rejects.toThrow('Failed to connect');
    });
});

describe('S3StorageAdapter - mocked send', () => {
    it('connects via HeadBucket and flips isConnected()', async () => {
        const adapter = makeAdapter();
        mockSend(adapter, () => ({}));
        await adapter.connect();
        expect(adapter.isConnected()).toBe(true);
    });

    it('disconnects and clears the connected flag', async () => {
        const adapter = makeAdapter();
        mockSend(adapter, () => ({}));
        await adapter.connect();
        await adapter.disconnect();
        expect(adapter.isConnected()).toBe(false);
    });

    it('put returns a correct StorageFile descriptor', async () => {
        const adapter = makeAdapter();
        const calls: any[] = [];
        mockSend(adapter, (cmd) => {
            calls.push(cmd);
            return {};
        });
        await adapter.connect();

        const file = await adapter.put('/docs/readme.txt', new Uint8Array([1, 2, 3]), {
            contentType: 'text/plain',
        });
        expect(file.path).toBe('docs/readme.txt');
        expect(file.name).toBe('readme.txt');
        expect(file.size).toBe(3);
        expect(file.mimeType).toBe('text/plain');

        const putCmd = calls.find((c) => c.constructor.name === 'PutObjectCommand');
        expect(putCmd.input.Key).toBe('docs/readme.txt');
        expect(putCmd.input.Bucket).toBe('test-bucket');
    });

    it('put handles a ReadableStream body', async () => {
        const adapter = makeAdapter();
        let putInput: any;
        mockSend(adapter, (cmd) => {
            if (cmd.constructor.name === 'PutObjectCommand') putInput = cmd.input;
            return {};
        });
        await adapter.connect();

        const stream = new Response(new Uint8Array([9, 9, 9, 9])).body!;
        const file = await adapter.put('data.bin', stream);
        expect(file.size).toBe(4);
        expect(putInput.Body).toBeInstanceOf(Uint8Array);
    });

    it('put rejects a stream longer than maxBytes, cancels it and uploads nothing', async () => {
        const adapter = makeAdapter();
        const sent: string[] = [];
        mockSend(adapter, (cmd) => {
            sent.push(cmd.constructor.name);
            return {};
        });
        await adapter.connect();
        sent.length = 0;

        let cancelled = false;
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array([1, 2, 3]));
                controller.enqueue(new Uint8Array([4, 5, 6, 7, 8, 9, 10]));
            },
            cancel() {
                cancelled = true;
            },
        });
        const err = await adapter.put('big.bin', stream, { maxBytes: 4 }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(RangeError);
        expect((err as Error).message).toBe('put(): stream exceeds maxBytes (4)');
        expect(cancelled).toBe(true);
        expect(sent).toEqual([]);
    });

    it('put accepts a stream of exactly maxBytes', async () => {
        const adapter = makeAdapter();
        let putInput: any;
        mockSend(adapter, (cmd) => {
            if (cmd.constructor.name === 'PutObjectCommand') putInput = cmd.input;
            return {};
        });
        await adapter.connect();

        const stream = new Response(new Uint8Array([1, 2, 3, 4])).body!;
        const file = await adapter.put('four.bin', stream, { maxBytes: 4 });
        expect(file.size).toBe(4);
        expect(Array.from(putInput.Body as Uint8Array)).toEqual([1, 2, 3, 4]);
    });

    it('get returns bytes from the response body', async () => {
        const adapter = makeAdapter();
        mockSend(adapter, (cmd) => {
            if (cmd.constructor.name === 'GetObjectCommand')
                return { Body: { transformToByteArray: async () => new Uint8Array([5, 6, 7]) } };
            return {};
        });
        await adapter.connect();
        const bytes = await adapter.get('file.txt');
        expect(Array.from(bytes!)).toEqual([5, 6, 7]);
    });

    it('get returns null on NoSuchKey', async () => {
        const adapter = makeAdapter();
        mockSend(adapter, (cmd) => {
            if (cmd.constructor.name === 'GetObjectCommand') {
                const err: any = new Error('missing');
                err.name = 'NoSuchKey';
                throw err;
            }
            return {};
        });
        await adapter.connect();
        expect(await adapter.get('missing.txt')).toBeNull();
    });

    it('exists returns true on HeadObject success and false on 404', async () => {
        const adapter = makeAdapter();
        let present = true;
        mockSend(adapter, (cmd) => {
            if (cmd.constructor.name === 'HeadObjectCommand') {
                if (!present) {
                    const e: any = new Error('nf');
                    e.$metadata = { httpStatusCode: 404 };
                    throw e;
                }
                return {};
            }
            return {};
        });
        await adapter.connect();
        expect(await adapter.exists('a.txt')).toBe(true);
        present = false;
        expect(await adapter.exists('b.txt')).toBe(false);
    });

    it('list paginates across multiple pages', async () => {
        const adapter = makeAdapter();
        let page = 0;
        mockSend(adapter, (cmd) => {
            if (cmd.constructor.name === 'ListObjectsV2Command') {
                page++;
                if (page === 1)
                    return {
                        Contents: [{ Key: 'a/one.txt', Size: 10 }],
                        IsTruncated: true,
                        NextContinuationToken: 't',
                    };
                return { Contents: [{ Key: 'a/two.png', Size: 20 }], IsTruncated: false };
            }
            return {};
        });
        await adapter.connect();
        const files = await adapter.list('a');
        expect(files.map((f) => f.path)).toEqual(['a/one.txt', 'a/two.png']);
        expect(files[0].size).toBe(10);
    });

    it('url returns a presigned URL containing the key and expiry', async () => {
        const adapter = makeAdapter();
        mockSend(adapter, () => ({}));
        await adapter.connect();
        const url = await adapter.url('file.txt', 120);
        expect(url).toContain('file.txt');
        expect(url).toContain('X-Amz-Expires=120');
    });

    it('copy sends CopyObjectCommand with correct source and dest', async () => {
        const adapter = makeAdapter();
        let copyInput: any;
        mockSend(adapter, (cmd) => {
            if (cmd.constructor.name === 'CopyObjectCommand') copyInput = cmd.input;
            return {};
        });
        await adapter.connect();
        await adapter.copy('src/a.txt', 'dst/b.txt');
        expect(copyInput.CopySource).toBe('test-bucket/src/a.txt');
        expect(copyInput.Key).toBe('dst/b.txt');
    });

    it('isDirectory detects a non-empty key prefix', async () => {
        const adapter = makeAdapter();
        mockSend(adapter, (cmd) => {
            if (cmd.constructor.name === 'ListObjectsV2Command') return { Contents: [{ Key: 'dir/x' }] };
            return {};
        });
        await adapter.connect();
        expect(await adapter.isDirectory('dir')).toBe(true);
    });

    it('delete sends DeleteObjectCommand', async () => {
        const adapter = makeAdapter();
        let deleted: any;
        mockSend(adapter, (cmd) => {
            if (cmd.constructor.name === 'DeleteObjectCommand') deleted = cmd.input;
            return {};
        });
        await adapter.connect();
        await adapter.delete('gone.txt');
        expect(deleted.Key).toBe('gone.txt');
    });
});

describe('S3StorageAdapter - getStream (mocked)', () => {
    it('issues GetObjectCommand and returns a ReadableStream via transformToWebStream', async () => {
        const adapter = makeAdapter();
        const content = new Uint8Array([10, 20, 30]);

        // Build a minimal body that exposes transformToWebStream
        const webStream = new ReadableStream({
            start(controller) {
                controller.enqueue(content);
                controller.close();
            },
        });

        const commands: string[] = [];
        mockSend(adapter, (cmd) => {
            commands.push(cmd.constructor.name);
            if (cmd.constructor.name === 'GetObjectCommand') {
                return { Body: { transformToWebStream: () => webStream } };
            }
            return {};
        });
        await adapter.connect();

        const stream = await adapter.getStream('data.bin');
        expect(stream).not.toBeNull();
        expect(commands).toContain('GetObjectCommand');

        // Read back all bytes from the stream
        const reader = stream!.getReader();
        const chunks: Uint8Array[] = [];
        let done = false;
        while (!done) {
            const result = await reader.read();
            done = result.done;
            if (result.value) chunks.push(result.value);
        }
        const flat = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
        let off = 0;
        for (const c of chunks) {
            flat.set(c, off);
            off += c.length;
        }
        expect(Array.from(flat)).toEqual([10, 20, 30]);
    });

    it('falls back to buffered ReadableStream when transformToWebStream is absent', async () => {
        const adapter = makeAdapter();
        mockSend(adapter, (cmd) => {
            if (cmd.constructor.name === 'GetObjectCommand') {
                return {
                    Body: {
                        transformToByteArray: async () => new Uint8Array([7, 8, 9]),
                        // no transformToWebStream
                    },
                };
            }
            return {};
        });
        await adapter.connect();

        const stream = await adapter.getStream('fallback.bin');
        expect(stream).not.toBeNull();

        const reader = stream!.getReader();
        const chunks: Uint8Array[] = [];
        let done = false;
        while (!done) {
            const result = await reader.read();
            done = result.done;
            if (result.value) chunks.push(result.value);
        }
        const flat = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
        let off = 0;
        for (const c of chunks) {
            flat.set(c, off);
            off += c.length;
        }
        expect(Array.from(flat)).toEqual([7, 8, 9]);
    });

    it('returns null on NoSuchKey', async () => {
        const adapter = makeAdapter();
        mockSend(adapter, (cmd) => {
            if (cmd.constructor.name === 'GetObjectCommand') {
                const err: any = new Error('missing');
                err.name = 'NoSuchKey';
                throw err;
            }
            return {};
        });
        await adapter.connect();
        expect(await adapter.getStream('missing.bin')).toBeNull();
    });
});

describe('S3StorageAdapter - factory integration', () => {
    it('StorageFeature can be constructed with s3 adapter (import check)', async () => {
        const feature = new S3StorageAdapter({
            adapter: 's3',
            connection: {
                endpoint: 'http://localhost:9000',
                accessKey: 'x',
                secretKey: 'x',
                bucket: 'b',
                useSSL: false,
            },
        });
        expect(feature).toBeDefined();
    });
});
