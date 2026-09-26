import { afterAll, describe, expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { S3StorageAdapter, type BaseStorageAdapter } from '@iskra-bun/storage-kit';
import { Kernel } from '../src/kernel';
import { UploadFeature } from '../src/features/upload';
import { UploadHelper } from '../src/features/upload/helper';
import { StorageFeature } from '../src/features/storage';
import type { UploadAction, UploadConfig, UploadTarget } from '../src/types';

const TEST_DIR = path.join(process.cwd(), 'test-upload-content-safety-storage');
afterAll(() => fs.rm(TEST_DIR, { recursive: true, force: true }));

/** A kernel whose storage feature hands the upload feature `adapter`. */
async function withAdapter(adapter: BaseStorageAdapter, config: Partial<UploadConfig> = {}) {
    const kernel = new Kernel();
    kernel.registerFeature({ name: 'storage', initialize: async () => {}, getAdapter: () => adapter } as any);
    kernel.registerFeature(
        new UploadFeature({ projectName: 'p', exposeRoutes: true, authorize: () => true, ...config }),
    );
    await kernel.initialize();
    return kernel;
}

/** A kernel on a fresh local folder. */
async function withLocal(config: Partial<UploadConfig> = {}, dir = `${TEST_DIR}/${crypto.randomUUID()}`) {
    const kernel = new Kernel();
    kernel.registerFeature(new StorageFeature({ adapter: 'local', basePath: dir }));
    kernel.registerFeature(
        new UploadFeature({ projectName: 'p', exposeRoutes: true, authorize: () => true, ...config }),
    );
    await kernel.initialize();
    return kernel;
}

function form(name: string, content: string, type?: string) {
    const fd = new FormData();
    fd.append('file', new File([content], name, type ? { type } : {}));
    return fd;
}

function s3Adapter() {
    const adapter = new S3StorageAdapter({
        adapter: 's3',
        connection: { region: 'us-east-1', bucket: 'b', accessKey: 'AKID', secretKey: 'secret' },
    });
    (adapter as any).connected = true;
    const puts: any[] = [];
    (adapter as any).client.send = async (cmd: any) => {
        if (cmd instanceof PutObjectCommand) puts.push(cmd.input);
        return {};
    };
    return { adapter, puts };
}

describe('upload route: stored content type', () => {
    it('refuses active web content unless allowedExtensions lists it', async () => {
        const kernel = await withLocal();
        const app = kernel.getApp();
        for (const name of ['logo.svg', 'invoice.html', 'feed.XML', 'app.js']) {
            const res = await app.request('/upload', { method: 'POST', body: form(name, '<svg onload=alert(1)>') });
            expect(res.status).toBe(400);
        }
        expect((await app.request('/upload', { method: 'POST', body: form('report.pdf', '%PDF') })).status).toBe(200);
        expect((await app.request('/upload', { method: 'POST', body: form('blob.bin', 'x') })).status).toBe(200);
        await kernel.shutdown();
    });

    it("stores a type from the extension, never the uploader's, and SVG as a download", async () => {
        const { adapter, puts } = s3Adapter();
        const kernel = await withAdapter(adapter, { allowedExtensions: ['.svg', '.png'] });
        const app = kernel.getApp();

        // Bun derives File.type from the name: this came in as image/svg+xml.
        expect((await app.request('/upload', { method: 'POST', body: form('logo.svg', '<svg/>') })).status).toBe(200);
        const png = form('photo.png', '<html><script>alert(1)</script>', 'text/html');
        expect((await app.request('/upload', { method: 'POST', body: png })).status).toBe(200);

        expect(puts.map((p) => [p.Key, p.ContentType, p.ContentDisposition])).toEqual([
            ['p/logo.svg', 'application/octet-stream', 'attachment'],
            ['p/photo.png', 'image/png', 'inline'],
        ]);
        await kernel.shutdown();
    });

    it('types uploadFromRequest() by extension too', async () => {
        const { adapter, puts } = s3Adapter();
        const helper = new UploadHelper(adapter, 'p', { allowedExtensions: ['.svg'] });
        const req = new Request('http://localhost/', { method: 'POST', body: form('logo.svg', '<svg/>') });
        await helper.uploadFromRequest(req, 'file');
        expect([puts[0].ContentType, puts[0].ContentDisposition]).toEqual(['application/octet-stream', 'attachment']);
    });

    it('uploadFromRequest() refuses active content, like the route', async () => {
        // Regression: it had no extension check, so `.html` was stored.
        const { adapter, puts } = s3Adapter();
        const helper = new UploadHelper(adapter, 'p');
        for (const name of ['invoice.html', 'logo.SVG', 'app.js']) {
            const req = new Request('http://localhost/', { method: 'POST', body: form(name, '<script>') });
            await expect(helper.uploadFromRequest(req, 'file')).rejects.toMatchObject({
                status: 400,
                message: 'Invalid extension',
            });
        }
        const pdf = new Request('http://localhost/', { method: 'POST', body: form('report.pdf', '%PDF') });
        await helper.uploadFromRequest(pdf, 'file');
        expect(puts.map((p) => p.Key)).toEqual(['p/report.pdf']);
    });

    it('uploadFromRequest() takes allowedExtensions', async () => {
        const { adapter, puts } = s3Adapter();
        const helper = new UploadHelper(adapter, 'p', { allowedExtensions: ['.PNG'] });
        const pdf = new Request('http://localhost/', { method: 'POST', body: form('report.pdf', '%PDF') });
        await expect(helper.uploadFromRequest(pdf, 'file')).rejects.toMatchObject({ status: 400 });
        const png = new Request('http://localhost/', { method: 'POST', body: form('photo.png', 'x') });
        await helper.uploadFromRequest(png, 'file');
        expect(puts.map((p) => p.Key)).toEqual(['p/photo.png']);
    });

    it('uploadFromRequest() refuses a file over maxFileSize', async () => {
        // Regression: it read any body whole, however large.
        const { adapter, puts } = s3Adapter();
        const helper = new UploadHelper(adapter, 'p', { maxFileSize: 1000 });
        const big = new Request('http://localhost/', { method: 'POST', body: form('big.bin', 'x'.repeat(1001)) });
        await expect(helper.uploadFromRequest(big, 'file')).rejects.toMatchObject({
            status: 413,
            message: 'File too large',
        });

        // A body far past the limit is cut off while it streams in.
        const huge = new Request('http://localhost/', {
            method: 'POST',
            body: form('huge.bin', 'x'.repeat(1024 * 1024)),
        });
        huge.headers.delete('content-length');
        await expect(helper.uploadFromRequest(huge, 'file')).rejects.toMatchObject({ status: 413 });
        expect(puts).toEqual([]);
    });

    it("UploadFeature's helper uses its maxFileSize and allowedExtensions", async () => {
        const { adapter, puts } = s3Adapter();
        const kernel = await withAdapter(adapter, { maxFileSize: 1000, allowedExtensions: ['.txt'] });
        const app = kernel.getApp();
        app.post('/mine', async (c) => {
            try {
                await c.get('upload').uploadFromRequest(c.req.raw, 'file');
                return c.text('ok');
            } catch (err: any) {
                return c.text(err.message, err.status);
            }
        });
        expect((await app.request('/mine', { method: 'POST', body: form('a.bin', 'x') })).status).toBe(400);
        const big = form('a.txt', 'x'.repeat(1001));
        expect((await app.request('/mine', { method: 'POST', body: big })).status).toBe(413);
        expect((await app.request('/mine', { method: 'POST', body: form('a.txt', 'x') })).status).toBe(200);
        expect(puts.map((p) => p.Key)).toEqual(['p/a.txt']);
        await kernel.shutdown();
    });

    it('serves downloads with those headers, sandboxed', async () => {
        const kernel = await withLocal({ allowedExtensions: ['.svg', '.png', '.pdf'] });
        const app = kernel.getApp();
        for (const name of ['logo.svg', 'photo.png', 'report.pdf']) {
            await app.request('/upload', { method: 'POST', body: form(name, 'x') });
        }

        const headers = async (name: string) => {
            const res = await app.request(`/upload/${name}`);
            expect(res.status).toBe(200);
            return [
                res.headers.get('content-type'),
                res.headers.get('content-disposition'),
                res.headers.get('content-security-policy'),
            ];
        };
        expect(await headers('logo.svg')).toEqual([
            'application/octet-stream',
            'attachment; filename="logo.svg"',
            'sandbox',
        ]);
        expect(await headers('photo.png')).toEqual(['image/png', 'inline; filename="photo.png"', 'sandbox']);
        expect(await headers('report.pdf')).toEqual([
            'application/pdf',
            'attachment; filename="report.pdf"',
            'sandbox',
        ]);
        await kernel.shutdown();
    });
});

describe('upload route: download streams', () => {
    it('answers before the whole file is read, without buffering it', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const adapter = {
            get: async () => {
                throw new Error('the download buffered the whole file');
            },
            getStream: async () =>
                new ReadableStream<Uint8Array>({
                    async start(controller) {
                        controller.enqueue(new TextEncoder().encode('first half, '));
                        await gate;
                        controller.enqueue(new TextEncoder().encode('second half'));
                        controller.close();
                    },
                }),
        } as unknown as BaseStorageAdapter;
        const kernel = await withAdapter(adapter);

        const res = await kernel.getApp().request('/upload/big.bin');
        expect(res.status).toBe(200);
        release();
        expect(await res.text()).toBe('first half, second half');
        await kernel.shutdown();
    });
});

describe('upload route: authorization and overwrites', () => {
    it('asks authorize again with the resolved target before writing', async () => {
        const calls: Array<[UploadAction, UploadTarget | undefined]> = [];
        const kernel = await withLocal({
            authorize: (_c, action, target) => {
                calls.push([action, target]);
                // Only into the caller's own folder.
                return !target || target.subfolder === 'users/42';
            },
        });
        const app = kernel.getApp();

        const denied = await app.request('/upload?subfolder=users/41', { method: 'POST', body: form('a.txt', 'x') });
        expect(denied.status).toBe(403);
        const ok = await app.request('/upload?subfolder=/users//42/./', { method: 'POST', body: form('a.txt', 'hi') });
        expect(ok.status).toBe(200);

        expect(calls).toEqual([
            ['upload', undefined],
            [
                'upload',
                { key: 'p/users/41/a.txt', filename: 'a.txt', subfolder: 'users/41', size: 1, type: 'text/plain' },
            ],
            ['upload', undefined],
            [
                'upload',
                { key: 'p/users/42/a.txt', filename: 'a.txt', subfolder: 'users/42', size: 2, type: 'text/plain' },
            ],
        ]);
        expect((await app.request('/upload/users/41/a.txt')).status).toBe(403);
        expect((await app.request('/upload/users/42/a.txt')).status).toBe(200);
        expect(calls.at(-1)).toEqual([
            'download',
            { key: 'p/users/42/a.txt', filename: 'a.txt', subfolder: 'users/42' },
        ]);
        expect((await app.request('/upload?subfolder=users/42')).status).toBe(200);
        expect(calls.at(-1)).toEqual(['list', { key: 'p/users/42', subfolder: 'users/42' }]);
        await kernel.shutdown();
    });

    it('does not replace a stored file unless overwrite is set', async () => {
        const dir = `${TEST_DIR}/${crypto.randomUUID()}`;
        const kernel = await withLocal({}, dir);
        const app = kernel.getApp();
        expect((await app.request('/upload', { method: 'POST', body: form('a.txt', 'mine') })).status).toBe(200);
        const again = await app.request('/upload', { method: 'POST', body: form('a.txt', 'theirs') });
        expect(again.status).toBe(409);
        expect(await (await app.request('/upload/a.txt')).text()).toBe('mine');
        await kernel.shutdown();

        const replacing = await withLocal({ overwrite: true }, dir);
        const res = await replacing.getApp().request('/upload', { method: 'POST', body: form('a.txt', 'new') });
        expect(res.status).toBe(200);
        expect(await (await replacing.getApp().request('/upload/a.txt')).text()).toBe('new');
        await replacing.shutdown();
    });
});
