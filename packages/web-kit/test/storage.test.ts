import { describe, expect, it, afterAll, beforeAll } from "bun:test";
import { Kernel } from "../src/kernel";
import { StorageFeature } from "../src/features/storage";
import { LocalStorageAdapter } from "../src/features/storage/adapters/local";
import fs from "node:fs/promises";
import path from "node:path";

const TEST_DIR = path.join(process.cwd(), "test-storage");

describe("Storage Feature", () => {
    it("should init and manipulate files", async () => {
        const kernel = new Kernel();
        const storage = new StorageFeature({
            adapter: "local",
            basePath: TEST_DIR
        });

        kernel.registerFeature(storage);
        await kernel.initialize();

        const app = kernel.getApp();
        expect(app).toBeDefined();

        // Test usage via helper/adapter (simulating context usage)
        const adapter = (storage as any).adapter; // Access private adapter for test

        const testFile = "hello.txt";
        const content = Buffer.from("Hello World");

        await adapter.put(testFile, content, { contentType: "text/plain" });

        const exists = await adapter.exists(testFile);
        expect(exists).toBe(true);

        const readContent = await adapter.get(testFile);
        expect(new TextDecoder().decode(readContent)).toBe("Hello World");

        await adapter.delete(testFile);
        const existsAfter = await adapter.exists(testFile);
        expect(existsAfter).toBe(false);

        await kernel.shutdown();
    });

    afterAll(async () => {
        try {
            await fs.rm(TEST_DIR, { recursive: true, force: true });
        } catch { /* ignored */ }
    });
});

describe("LocalStorageAdapter operations", () => {
    const DIR = path.join(process.cwd(), "test-storage-ops");
    let adapter: LocalStorageAdapter;

    beforeAll(async () => {
        adapter = new LocalStorageAdapter({ adapter: "local", basePath: DIR });
        await adapter.connect();
    });

    afterAll(async () => {
        try {
            await fs.rm(DIR, { recursive: true, force: true });
        } catch { /* ignored */ }
    });

    it("returns null when getting a missing file", async () => {
        expect(await adapter.get("does/not/exist.txt")).toBeNull();
    });

    it("copies a file (keeping the source) via the base adapter", async () => {
        await adapter.put("src/a.txt", Buffer.from("data"));
        await adapter.copy("src/a.txt", "dst/b.txt");

        expect(await adapter.exists("dst/b.txt")).toBe(true);
        expect(await adapter.exists("src/a.txt")).toBe(true);
        expect(new TextDecoder().decode((await adapter.get("dst/b.txt"))!)).toBe("data");
    });

    it("moves a file (removing the source) via the base adapter", async () => {
        await adapter.put("move/from.txt", Buffer.from("payload"));
        await adapter.move("move/from.txt", "move/to.txt");

        expect(await adapter.exists("move/to.txt")).toBe(true);
        expect(await adapter.exists("move/from.txt")).toBe(false);
    });

    it("throws when copying a missing source", async () => {
        await expect(adapter.copy("nope/missing.txt", "x.txt")).rejects.toThrow("Source file not found");
    });

    it("lists files recursively and detects directories", async () => {
        await adapter.put("listdir/one.txt", Buffer.from("1"));
        await adapter.put("listdir/sub/two.txt", Buffer.from("2"));

        const paths = (await adapter.list("listdir")).map((f) => f.path);
        expect(paths).toContain("listdir/one.txt");
        expect(paths).toContain("listdir/sub/two.txt");

        expect(await adapter.isDirectory("listdir")).toBe(true);
        expect(await adapter.isDirectory("listdir/one.txt")).toBe(false);
        expect(await adapter.isDirectory("listdir/missing")).toBe(false);
    });

    it("deleting a missing file is a no-op", async () => {
        await adapter.delete("never/existed.txt");
    });

    it("returns a local url for a path", async () => {
        expect(await adapter.url("a/b.txt")).toBe("/storage/a/b.txt");
    });
});
