import { describe, expect, it } from "bun:test";

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
