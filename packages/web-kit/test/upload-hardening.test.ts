import { describe, expect, it, afterAll } from "bun:test";
import { Kernel } from "../src/kernel";
import { UploadFeature } from "../src/features/upload";
import { StorageFeature } from "../src/features/storage";
import type { UploadAction } from "../src/types";
import fs from "node:fs/promises";
import path from "node:path";

const TEST_DIR = path.join(process.cwd(), "test-upload-hardening-storage");
afterAll(() => fs.rm(TEST_DIR, { recursive: true, force: true }));

async function setup(authorize: (c: any, action: UploadAction) => boolean, maxFileSize = 1024, kernel = new Kernel()) {
    kernel.registerFeature(new StorageFeature({ adapter: "local", basePath: TEST_DIR }));
    const upload = new UploadFeature({ projectName: "p", exposeRoutes: true, routePrefix: "/files", maxFileSize, authorize });
    kernel.registerFeature(upload);
    await kernel.initialize();
    return { kernel, app: kernel.getApp(), upload };
}

function form(name: string, content: string) {
    const fd = new FormData();
    fd.append("file", new File([content], name, { type: "text/plain" }));
    return fd;
}

describe("UploadFeature route hardening", () => {
    it("refuses to expose routes without an authorize decision", () => {
        expect(() => new UploadFeature({ projectName: "p", exposeRoutes: true })).toThrow(/authorize/);
        // Not exposing routes needs no callback.
        expect(() => new UploadFeature({ projectName: "p" })).not.toThrow();
    });

    it("fails at initialize when maxFileSize cannot fit in the Kernel's body limit", async () => {
        // Regression: Bun answered a bare 413 for any upload above the Kernel's
        // 16 MiB default, whatever maxFileSize allowed.
        const allow = () => true;
        await expect(setup(allow, 50 * 1024 * 1024)).rejects.toThrow(/maxRequestBodySize/);

        const raised = await setup(allow, 50 * 1024 * 1024, new Kernel({ maxRequestBodySize: 64 * 1024 * 1024 }));
        await raised.kernel.shutdown();
        const fits = await setup(allow, 10 * 1024 * 1024);
        await fits.kernel.shutdown();
    });

    it("asks authorize for every action and returns 403 when denied", async () => {
        const asked: UploadAction[] = [];
        const { kernel, app } = await setup((_c, action) => {
            asked.push(action);
            return false;
        });

        expect((await app.request("/files", { method: "POST", body: form("a.txt", "x") })).status).toBe(403);
        expect((await app.request("/files")).status).toBe(403);
        expect((await app.request("/files/a.txt")).status).toBe(403);
        expect((await app.request("/files/a.txt", { method: "DELETE" })).status).toBe(403);
        expect(asked).toEqual(["upload", "list", "download", "delete"]);
        await kernel.shutdown();
    });

    it("rejects a declared oversized body before reading it", async () => {
        const { kernel, app } = await setup(() => true);
        const res = await app.request("/files", {
            method: "POST",
            headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(10 * 1024 * 1024) },
            body: "--x--",
        });
        expect(res.status).toBe(413);
        await kernel.shutdown();
    });

    it("stops reading a streamed body once it passes the limit", async () => {
        const { kernel, app } = await setup(() => true);
        const boundary = "b0undary";
        let pulled = 0;
        const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(
                    new TextEncoder().encode(
                        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.txt"\r\n\r\n`,
                    ),
                );
            },
            pull(controller) {
                // ~100 MB if fully consumed; the limit is ~65 KB.
                if (++pulled > 1600) controller.close();
                else controller.enqueue(chunk);
            },
        });
        const res = await app.request("/files", {
            method: "POST",
            headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
            body,
            duplex: "half",
        } as RequestInit);
        expect(res.status).toBe(413);
        expect(pulled).toBeLessThan(10);
        await kernel.shutdown();
    });

    it("stores the upload under a sanitized basename", async () => {
        const { kernel, app } = await setup(() => true);
        const res = await app.request("/files", { method: "POST", body: form("../../etc/pass wd.txt", "hi") });
        expect(res.status).toBe(200);
        const json = (await res.json()) as any;
        expect(json.filename).toBe("pass_wd.txt");
        expect(json.path).toBe("p/pass_wd.txt");
        await kernel.shutdown();
    });

    it("does not echo internal storage errors to the client", async () => {
        const { kernel, app, upload } = await setup(() => true);
        (upload as any).helper.list = async () => {
            throw new Error("AccessDenied: s3://internal-bucket (key AKIA...)");
        };
        const res = await app.request("/files");
        expect(res.status).toBe(500);
        expect(await res.text()).not.toContain("internal-bucket");
        await kernel.shutdown();
    });
});
