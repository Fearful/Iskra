import { describe, expect, it, beforeAll, beforeEach, afterAll } from "bun:test";
import { LocalStorageAdapter } from "../src/adapters/local";
import { BaseStorageAdapter } from "../src/base";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

// Covers: CRITICAL path traversal (src/base.ts sanitizePath + src/adapters/local.ts).
// Fix expectation:
//   - sanitizePath strips "." / ".." segments so the result never escapes upward.
//   - LocalStorageAdapter resolves the joined path and rejects anything that
//     escapes the storage root ("Path escapes storage root"), OR contains the
//     access strictly inside basePath. Either way, files outside the root are
//     never read, written, or deleted via traversal input.

// BASE sits one directory below ROOT so that a single ".." escape from BASE
// lands exactly on the OUTSIDE sentinel. Anchoring the sentinel relative to BASE
// (rather than the absolute tmpdir) makes traversal resolution deterministic
// regardless of how deep the OS temp directory is.
const ROOT = path.join(os.tmpdir(), `storage-kit-traversal-${process.pid}`);
const BASE = path.join(ROOT, "store");
const OUTSIDE = path.resolve(path.join(BASE, "..", "secret.txt")); // === ROOT/secret.txt
const OUTSIDE_CONTENT = "TOP-SECRET-DO-NOT-LEAK";

let adapter: LocalStorageAdapter;

beforeAll(async () => {
    await fs.mkdir(ROOT, { recursive: true });
    adapter = new LocalStorageAdapter({ adapter: "local", basePath: BASE });
    await adapter.connect();
});

// Restore the sentinel before every test so each test is independent: a put that
// (on vulnerable code) overwrites it must not affect a subsequent get/delete test.
beforeEach(async () => {
    await fs.mkdir(ROOT, { recursive: true });
    await fs.writeFile(OUTSIDE, OUTSIDE_CONTENT);
});

afterAll(async () => {
    await fs.rm(ROOT, { recursive: true, force: true });
});

// Expose the protected sanitizePath for direct assertions.
class ExposedAdapter extends BaseStorageAdapter {
    async connect() {}
    async disconnect() {}
    async put(): Promise<any> { return {}; }
    async get() { return null; }
    async getStream() { return null; }
    async delete() {}
    async exists() { return false; }
    async list() { return []; }
    async url() { return ""; }
    async isDirectory() { return false; }
    public sanitize(p: string) {
        return this.sanitizePath(p);
    }
}

const TRAVERSAL_PATHS = [
    "../../etc/passwd",
    "foo/../../../../etc/passwd",
    "..\\..\\etc\\passwd",
    "foo\\..\\..\\..\\..\\etc\\passwd",
    "....//....//etc/passwd",
    "/../../etc/passwd",
];

describe("sanitizePath strips traversal segments", () => {
    const exposed = new ExposedAdapter();

    for (const input of TRAVERSAL_PATHS) {
        it(`removes ".." segments from "${input}"`, () => {
            const result = exposed.sanitize(input);
            // After sanitization no ".." segment may survive.
            const segments = result.split("/");
            expect(segments).not.toContain("..");
            // And the result must not start with a parent reference.
            expect(result.startsWith("..")).toBe(false);
        });
    }
});

// A single ".." from BASE (ROOT/store) lands exactly on the OUTSIDE sentinel at
// ROOT/secret.txt. We deliberately target the real sentinel so that a passing
// test proves containment, not a lucky miss against a non-existent path.
const PUT_PAYLOADS = [
    "../secret.txt", // direct escape to the sentinel
    "a/../../secret.txt", // escape that resolves to the sentinel
    "..\\secret.txt", // backslash escape to the sentinel
];

describe("LocalStorageAdapter contains traversal in put()", () => {
    for (const payload of PUT_PAYLOADS) {
        it(`does not overwrite the outside sentinel via "${payload}"`, async () => {
            try {
                await adapter.put(payload, Buffer.from("HACKED"));
            } catch (err: any) {
                expect(err.message).toMatch(/escapes storage root/i);
            }
            // The sentinel content must be intact regardless of throw-or-contain.
            const after = await fs.readFile(OUTSIDE, "utf8");
            expect(after).toBe(OUTSIDE_CONTENT);
        });
    }
});

describe("LocalStorageAdapter contains traversal in get()", () => {
    const GET_PAYLOADS = [
        "../secret.txt",
        "x/y/../../../secret.txt",
        "..\\secret.txt",
    ];

    for (const payload of GET_PAYLOADS) {
        it(`cannot read the outside sentinel via "${payload}"`, async () => {
            let bytes: Uint8Array | null = null;
            try {
                bytes = await adapter.get(payload);
            } catch (err: any) {
                expect(err.message).toMatch(/escapes storage root/i);
                return;
            }
            // If it didn't throw, it must not have leaked the sentinel content.
            if (bytes) {
                expect(new TextDecoder().decode(bytes)).not.toBe(OUTSIDE_CONTENT);
            }
        });
    }
});

describe("LocalStorageAdapter contains traversal in delete()", () => {
    it("cannot delete the outside sentinel via ..", async () => {
        // Recreate the sentinel in case an earlier test contained a write into it.
        await fs.writeFile(OUTSIDE, OUTSIDE_CONTENT);

        try {
            await adapter.delete("../secret.txt");
        } catch (err: any) {
            expect(err.message).toMatch(/escapes storage root/i);
        }

        // The outside sentinel must still exist.
        const exists = await fs
            .access(OUTSIDE)
            .then(() => true)
            .catch(() => false);
        expect(exists).toBe(true);
    });
});
