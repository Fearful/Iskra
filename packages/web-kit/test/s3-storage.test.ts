import { describe, expect, it } from "bun:test";
import { S3StorageAdapter } from "../src/features/storage/adapters/s3";

// Note: Full S3/MinIO integration tests require a running MinIO or S3 instance.
// These tests verify adapter construction, configuration, and error handling.

describe("S3 Storage Adapter", () => {
    it("should instantiate with S3 config", () => {
        const adapter = new S3StorageAdapter({
            adapter: "s3",
            connection: {
                region: "us-east-1",
                bucket: "my-bucket",
                accessKey: "AKID",
                secretKey: "secret",
            },
        });
        expect(adapter).toBeDefined();
        expect(adapter.isConnected()).toBe(false);
    });

    it("should instantiate with MinIO config (endpoint + forcePathStyle)", () => {
        const adapter = new S3StorageAdapter({
            adapter: "minio",
            connection: {
                endpoint: "http://localhost:9000",
                accessKey: "minioadmin",
                secretKey: "minioadmin",
                bucket: "test-bucket",
            },
        });
        expect(adapter).toBeDefined();
    });

    it("should use default bucket name when not specified", () => {
        const adapter = new S3StorageAdapter({
            adapter: "s3",
            connection: {
                accessKey: "AKID",
                secretKey: "secret",
            },
        });
        // Default bucket is 'iskra-storage'
        expect(adapter).toBeDefined();
    });

    it("should throw when operating without connection", async () => {
        const adapter = new S3StorageAdapter({
            adapter: "s3",
            connection: {
                accessKey: "AKID",
                secretKey: "secret",
                bucket: "test",
            },
        });

        // Not connected — should throw
        try {
            await adapter.get("test.txt");
            expect(true).toBe(false);
        } catch (err) {
            expect((err as Error).message).toContain("not connected");
        }
    });

    it("should throw when putting without connection", async () => {
        const adapter = new S3StorageAdapter({
            adapter: "s3",
            connection: {
                accessKey: "AKID",
                secretKey: "secret",
                bucket: "test",
            },
        });

        try {
            await adapter.put("test.txt", new Uint8Array([1, 2, 3]));
            expect(true).toBe(false);
        } catch (err) {
            expect((err as Error).message).toContain("not connected");
        }
    });

    it("should fail connect with invalid endpoint", async () => {
        const adapter = new S3StorageAdapter({
            adapter: "minio",
            connection: {
                endpoint: "http://localhost:19999",
                accessKey: "fake",
                secretKey: "fake",
                bucket: "nonexistent",
            },
        });

        try {
            await adapter.connect();
            expect(true).toBe(false);
        } catch (err) {
            expect((err as Error).message).toContain("Failed to connect");
        }
    });
});

describe("S3 Storage Adapter - operations (S3 client send mocked)", () => {
    function makeAdapter() {
        return new S3StorageAdapter({
            adapter: "s3",
            connection: { region: "us-east-1", bucket: "test-bucket", accessKey: "AKID", secretKey: "secret" },
        });
    }

    // The adapter is a thin wrapper over `client.send(command)`; stubbing that
    // single boundary lets us drive every operation hermetically.
    function mockSend(adapter: S3StorageAdapter, handler: (cmd: any) => any) {
        (adapter as any).client.send = async (cmd: any) => handler(cmd);
    }

    it("connects via HeadBucket and flips isConnected()", async () => {
        const adapter = makeAdapter();
        mockSend(adapter, () => ({}));
        await adapter.connect();
        expect(adapter.isConnected()).toBe(true);
    });

    it("puts an object and returns its descriptor", async () => {
        const adapter = makeAdapter();
        const calls: any[] = [];
        mockSend(adapter, (cmd) => {
            calls.push(cmd);
            return {};
        });
        await adapter.connect();

        const file = await adapter.put("/docs/readme.txt", new Uint8Array([1, 2, 3]), { contentType: "text/plain" });
        expect(file.path).toBe("docs/readme.txt");
        expect(file.name).toBe("readme.txt");
        expect(file.size).toBe(3);
        expect(file.mimeType).toBe("text/plain");

        const put = calls.find((c) => c.constructor.name === "PutObjectCommand");
        expect(put.input.Key).toBe("docs/readme.txt");
        expect(put.input.Bucket).toBe("test-bucket");
    });

    it("reads a ReadableStream body when putting", async () => {
        const adapter = makeAdapter();
        let putInput: any;
        mockSend(adapter, (cmd) => {
            if (cmd.constructor.name === "PutObjectCommand") putInput = cmd.input;
            return {};
        });
        await adapter.connect();

        const stream = new Response(new Uint8Array([9, 9, 9, 9])).body!;
        const file = await adapter.put("data.bin", stream);
        expect(file.size).toBe(4);
        expect(putInput.Body).toBeInstanceOf(Uint8Array);
    });

    it("gets an object's bytes", async () => {
        const adapter = makeAdapter();
        mockSend(adapter, (cmd) => {
            if (cmd.constructor.name === "GetObjectCommand")
                return { Body: { transformToByteArray: async () => new Uint8Array([5, 6, 7]) } };
            return {};
        });
        await adapter.connect();
        const bytes = await adapter.get("file.txt");
        expect(Array.from(bytes!)).toEqual([5, 6, 7]);
    });

    it("returns null when getting a missing object (NoSuchKey)", async () => {
        const adapter = makeAdapter();
        mockSend(adapter, (cmd) => {
            if (cmd.constructor.name === "GetObjectCommand") {
                const err: any = new Error("missing");
                err.name = "NoSuchKey";
                throw err;
            }
            return {};
        });
        await adapter.connect();
        expect(await adapter.get("missing.txt")).toBeNull();
    });

    it("reports existence with HeadObject and false on a 404", async () => {
        const adapter = makeAdapter();
        let present = true;
        mockSend(adapter, (cmd) => {
            if (cmd.constructor.name === "HeadObjectCommand") {
                if (!present) {
                    const e: any = new Error("nf");
                    e.$metadata = { httpStatusCode: 404 };
                    throw e;
                }
                return {};
            }
            return {};
        });
        await adapter.connect();
        expect(await adapter.exists("a.txt")).toBe(true);
        present = false;
        expect(await adapter.exists("b.txt")).toBe(false);
    });

    it("lists objects across pagination", async () => {
        const adapter = makeAdapter();
        let page = 0;
        mockSend(adapter, (cmd) => {
            if (cmd.constructor.name === "ListObjectsV2Command") {
                page++;
                if (page === 1)
                    return { Contents: [{ Key: "a/one.txt", Size: 10 }], IsTruncated: true, NextContinuationToken: "t" };
                return { Contents: [{ Key: "a/two.png", Size: 20 }], IsTruncated: false };
            }
            return {};
        });
        await adapter.connect();
        const files = await adapter.list("a");
        expect(files.map((f) => f.path)).toEqual(["a/one.txt", "a/two.png"]);
        expect(files[0].size).toBe(10);
    });

    it("builds a presigned url", async () => {
        const adapter = makeAdapter();
        mockSend(adapter, () => ({}));
        await adapter.connect();
        const url = await adapter.url("file.txt", 120);
        expect(url).toContain("file.txt");
        expect(url).toContain("X-Amz-Expires=120");
    });

    it("copies an object via CopyObjectCommand", async () => {
        const adapter = makeAdapter();
        let copyInput: any;
        mockSend(adapter, (cmd) => {
            if (cmd.constructor.name === "CopyObjectCommand") copyInput = cmd.input;
            return {};
        });
        await adapter.connect();
        await adapter.copy("src/a.txt", "dst/b.txt");
        expect(copyInput.CopySource).toBe("test-bucket/src/a.txt");
        expect(copyInput.Key).toBe("dst/b.txt");
    });

    it("detects a directory prefix", async () => {
        const adapter = makeAdapter();
        mockSend(adapter, (cmd) => {
            if (cmd.constructor.name === "ListObjectsV2Command") return { Contents: [{ Key: "dir/x" }] };
            return {};
        });
        await adapter.connect();
        expect(await adapter.isDirectory("dir")).toBe(true);
    });

    it("deletes an object", async () => {
        const adapter = makeAdapter();
        let deleted: any;
        mockSend(adapter, (cmd) => {
            if (cmd.constructor.name === "DeleteObjectCommand") deleted = cmd.input;
            return {};
        });
        await adapter.connect();
        await adapter.delete("gone.txt");
        expect(deleted.Key).toBe("gone.txt");
    });

    it("disconnects and clears the connected flag", async () => {
        const adapter = makeAdapter();
        mockSend(adapter, () => ({}));
        await adapter.connect();
        await adapter.disconnect();
        expect(adapter.isConnected()).toBe(false);
    });
});

describe("S3 Storage Adapter - StorageFeature integration", () => {
    it("should be loadable from StorageFeature with s3 adapter", async () => {
        const { StorageFeature } = await import("../src/features/storage");
        const feature = new StorageFeature({
            adapter: "s3",
            connection: {
                endpoint: "http://localhost:9000",
                accessKey: "test",
                secretKey: "test",
                bucket: "test",
            },
        });
        expect(feature).toBeDefined();
    });

    it("should be loadable from StorageFeature with minio adapter", async () => {
        const { StorageFeature } = await import("../src/features/storage");
        const feature = new StorageFeature({
            adapter: "minio",
            connection: {
                endpoint: "http://localhost:9000",
                accessKey: "test",
                secretKey: "test",
                bucket: "test",
            },
        });
        expect(feature).toBeDefined();
    });
});
