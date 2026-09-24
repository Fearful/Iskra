import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CopyObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { S3StorageAdapter } from "../src/adapters/s3";
import { LocalStorageAdapter } from "../src/adapters/local";

function s3() {
    const adapter = new S3StorageAdapter({
        adapter: "s3",
        connection: { region: "us-east-1", bucket: "b", accessKey: "AKID", secretKey: "secret" },
    });
    (adapter as any).connected = true;
    const sent: any[] = [];
    (adapter as any).client.send = async (cmd: any) => {
        sent.push(cmd);
        return { Contents: [], IsTruncated: false };
    };
    return { adapter, sent };
}

describe("S3StorageAdapter", () => {
    it("list() treats the prefix as a folder, so other folders sharing it are not listed", async () => {
        const { adapter, sent } = s3();
        await adapter.list("acme/");
        await adapter.list("users/1");
        await adapter.list("/");
        const prefixes = sent
            .filter((c) => c instanceof ListObjectsV2Command)
            .map((c) => c.input.Prefix);
        // "acme" used to match "acme-internal/…" and "users/1" "users/10/…".
        expect(prefixes).toEqual(["acme/", "users/1/", undefined]);
    });

    it("copy() URL-encodes the CopySource key", async () => {
        const { adapter, sent } = s3();
        await adapter.copy("reports/100%25 done.txt", "x.txt");
        await adapter.copy("reports/café.txt", "y.txt");
        const sources = sent.filter((c) => c instanceof CopyObjectCommand).map((c) => c.input.CopySource);
        expect(sources).toEqual(["b/reports/100%2525%20done.txt", "b/reports/caf%C3%A9.txt"]);
    });

    it("refuses a plaintext endpoint regardless of the scheme's case", () => {
        for (const endpoint of ["HTTP://minio:9000", "Http://minio:9000", " http://minio:9000"]) {
            expect(
                () =>
                    new S3StorageAdapter({
                        adapter: "minio",
                        connection: { endpoint, accessKey: "a", secretKey: "b", bucket: "b" },
                    }),
            ).toThrow(/plaintext/);
        }
    });
});

describe("move() onto the same path", () => {
    const dir = mkdtempSync(join(tmpdir(), "storage-kit-move-"));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it("keeps the file instead of copying it onto itself and deleting it", async () => {
        const storage = new LocalStorageAdapter({ adapter: "local", basePath: dir });
        await storage.connect();
        await storage.put("docs/report.pdf", new TextEncoder().encode("important"));

        await storage.move("docs/report.pdf", "docs/report.pdf");
        await storage.move("docs/report.pdf", "./docs//report.pdf");

        expect(new TextDecoder().decode((await storage.get("docs/report.pdf"))!)).toBe("important");
        await expect(storage.move("missing.txt", "missing.txt")).rejects.toThrow(/not found/);
    });
});
