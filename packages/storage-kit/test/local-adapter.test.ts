import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { LocalStorageAdapter } from "../src/adapters/local";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

const DIR = path.join(os.tmpdir(), `storage-kit-local-${process.pid}`);
let adapter: LocalStorageAdapter;

beforeAll(async () => {
    adapter = new LocalStorageAdapter({ adapter: "local", basePath: DIR });
    await adapter.connect();
});

afterAll(async () => {
    await fs.rm(DIR, { recursive: true, force: true });
});

describe("LocalStorageAdapter - connect / disconnect", () => {
    it("is connected after connect()", () => {
        expect(adapter.isConnected()).toBe(true);
    });

    it("is not connected after disconnect()", async () => {
        const tmp = new LocalStorageAdapter({ adapter: "local", basePath: DIR });
        await tmp.connect();
        await tmp.disconnect();
        expect(tmp.isConnected()).toBe(false);
    });
});

describe("LocalStorageAdapter - put / get / exists / delete", () => {
    it("put stores a file and returns its descriptor", async () => {
        const file = await adapter.put("docs/hello.txt", Buffer.from("Hello World"), {
            contentType: "text/plain",
        });

        expect(file.name).toBe("hello.txt");
        expect(file.path).toBe("docs/hello.txt");
        expect(file.size).toBe(11);
        expect(file.mimeType).toBe("text/plain");
        expect(file.url).toBe("/storage/docs/hello.txt");
        expect(file.lastModified).toBeInstanceOf(Date);
    });

    it("get returns the stored bytes", async () => {
        await adapter.put("get/test.txt", Buffer.from("abc"));
        const bytes = await adapter.get("get/test.txt");
        expect(new TextDecoder().decode(bytes!)).toBe("abc");
    });

    it("get returns null for a missing file", async () => {
        expect(await adapter.get("does/not/exist.txt")).toBeNull();
    });

    it("exists returns true for a stored file", async () => {
        await adapter.put("exists/yes.txt", Buffer.from("y"));
        expect(await adapter.exists("exists/yes.txt")).toBe(true);
    });

    it("exists returns false for a missing file", async () => {
        expect(await adapter.exists("exists/no.txt")).toBe(false);
    });

    it("delete removes the file", async () => {
        await adapter.put("del/file.txt", Buffer.from("bye"));
        await adapter.delete("del/file.txt");
        expect(await adapter.exists("del/file.txt")).toBe(false);
    });

    it("deleting a missing file is a no-op", async () => {
        await adapter.delete("never/existed.txt");
    });
});

describe("LocalStorageAdapter - getStream", () => {
    it("returns a ReadableStream whose bytes match the original content", async () => {
        const content = new Uint8Array([1, 2, 3, 4, 5]);
        await adapter.put("stream/data.bin", content);

        const stream = await adapter.getStream("stream/data.bin");
        expect(stream).not.toBeNull();

        const reader = stream!.getReader();
        const chunks: Uint8Array[] = [];
        let done = false;
        while (!done) {
            const result = await reader.read();
            done = result.done;
            if (result.value) chunks.push(result.value);
        }

        const combined = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0));
        let offset = 0;
        for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
        }

        expect(Array.from(combined)).toEqual([1, 2, 3, 4, 5]);
    });

    it("returns null when the file does not exist", async () => {
        expect(await adapter.getStream("stream/missing.bin")).toBeNull();
    });
});

describe("LocalStorageAdapter - list / isDirectory", () => {
    it("lists files recursively under a prefix", async () => {
        await adapter.put("listdir/one.txt", Buffer.from("1"));
        await adapter.put("listdir/sub/two.txt", Buffer.from("2"));

        const paths = (await adapter.list("listdir")).map((f) => f.path);
        expect(paths).toContain("listdir/one.txt");
        expect(paths).toContain("listdir/sub/two.txt");
    });

    it("isDirectory returns true for a directory", async () => {
        await adapter.put("dircheck/file.txt", Buffer.from("x"));
        expect(await adapter.isDirectory("dircheck")).toBe(true);
    });

    it("isDirectory returns false for a file", async () => {
        await adapter.put("dircheck2/file.txt", Buffer.from("x"));
        expect(await adapter.isDirectory("dircheck2/file.txt")).toBe(false);
    });

    it("isDirectory returns false for a missing path", async () => {
        expect(await adapter.isDirectory("nonexistent/path")).toBe(false);
    });
});

describe("LocalStorageAdapter - copy / move", () => {
    it("copy duplicates the file without removing the source", async () => {
        await adapter.put("copy/src.txt", Buffer.from("copydata"));
        await adapter.copy("copy/src.txt", "copy/dst.txt");

        expect(await adapter.exists("copy/dst.txt")).toBe(true);
        expect(await adapter.exists("copy/src.txt")).toBe(true);
        expect(new TextDecoder().decode((await adapter.get("copy/dst.txt"))!)).toBe("copydata");
    });

    it("copy throws when the source file is missing", async () => {
        await expect(adapter.copy("copy/missing.txt", "copy/out.txt")).rejects.toThrow(
            "Source file not found"
        );
    });

    it("move transfers the file and removes the source", async () => {
        await adapter.put("move/from.txt", Buffer.from("payload"));
        await adapter.move("move/from.txt", "move/to.txt");

        expect(await adapter.exists("move/to.txt")).toBe(true);
        expect(await adapter.exists("move/from.txt")).toBe(false);
    });
});

describe("LocalStorageAdapter - url", () => {
    it("returns a local storage URL for a path", async () => {
        expect(await adapter.url("a/b.txt")).toBe("/storage/a/b.txt");
    });
});
