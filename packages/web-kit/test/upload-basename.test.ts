import { describe, it, expect } from 'bun:test';
import { UploadHelper } from '../src/features/upload/helper';
import type { BaseStorageAdapter } from '@iskra-bun/storage-kit';

// RED test for the MEDIUM "upload basename" finding
// (src/features/upload/helper.ts). uploadFromRequest passes attacker-controlled
// file.name straight into buildPath. Defense-in-depth requires reducing the
// filename to its basename and applying an allowlist charset before building the
// storage path, so a traversal filename like "../../etc/passwd" can never climb
// out of the project base path.

// Fake adapter that records every path handed to put().
function makeRecordingAdapter() {
    const puts: string[] = [];
    const adapter = {
        put: async (path: string) => {
            puts.push(path);
            return { path, size: 0 };
        },
        get: async () => null,
        delete: async () => undefined,
        list: async () => [],
        url: async (p: string) => p,
        connect: async () => undefined,
        disconnect: async () => undefined,
    } as unknown as BaseStorageAdapter;
    return { adapter, puts };
}

describe('UploadHelper — traversal-safe filenames', () => {
    it('neutralizes a path-traversal filename from uploadFromRequest', async () => {
        const { adapter, puts } = makeRecordingAdapter();
        const helper = new UploadHelper(adapter, 'myproject');

        const form = new FormData();
        form.append('file', new File(['x'], '../../etc/passwd', { type: 'text/plain' }));
        const req = new Request('http://localhost/upload', { method: 'POST', body: form });

        const result = await helper.uploadFromRequest(req, 'file');

        // The stored path must stay anchored under the project base path and must
        // not contain any traversal segments.
        expect(puts.length).toBe(1);
        const storedPath = puts[0];
        expect(storedPath.startsWith('myproject/')).toBe(true);
        expect(storedPath).not.toContain('..');
        expect(storedPath).not.toContain('/etc/passwd');

        // The returned filename must be the neutralized basename, not the raw
        // attacker-supplied traversal string.
        expect(result.filename).not.toContain('..');
        expect(result.filename).not.toContain('/');
    });

    it('reduces a nested subfolder traversal to a safe basename path', async () => {
        const { adapter, puts } = makeRecordingAdapter();
        const helper = new UploadHelper(adapter, 'myproject');

        const form = new FormData();
        form.append('file', new File(['x'], '..\\..\\windows\\system32\\evil.dll'));
        const req = new Request('http://localhost/upload', { method: 'POST', body: form });

        await helper.uploadFromRequest(req, 'file');

        const storedPath = puts[0];
        expect(storedPath).not.toContain('..');
        expect(storedPath).not.toContain('\\');
        expect(storedPath.startsWith('myproject/')).toBe(true);
    });
});
