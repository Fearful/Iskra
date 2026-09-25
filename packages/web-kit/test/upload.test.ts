import { describe, expect, it, afterAll } from 'bun:test';
import { Kernel } from '../src/kernel';
import { UploadFeature } from '../src/features/upload';
import { StorageFeature } from '../src/features/storage';
import fs from 'node:fs/promises';
import path from 'node:path';

const TEST_DIR = path.join(process.cwd(), 'test-upload-storage');

describe('Upload Feature Routes', () => {
    let kernel: Kernel;

    afterAll(async () => {
        if (kernel) await kernel.shutdown();
        try {
            await fs.rm(TEST_DIR, { recursive: true, force: true });
        } catch {
            /* ignored */
        }
    });

    it('should upload, list, download, and delete files', async () => {
        kernel = new Kernel();
        kernel.registerFeature(new StorageFeature({ adapter: 'local', basePath: TEST_DIR }));
        kernel.registerFeature(
            new UploadFeature({
                projectName: 'test-project',
                exposeRoutes: true,
                authorize: () => true,
                routePrefix: '/files',
            }),
        );
        await kernel.initialize();

        const app = kernel.getApp();
        // Mount routes
        const uploadFeature = kernel.getFeature('upload') as any;
        uploadFeature.routes(app);

        // 1. Upload a file via POST
        const formData = new FormData();
        formData.append('file', new File(['Hello World'], 'test.txt', { type: 'text/plain' }));

        const uploadRes = await app.request('/files', {
            method: 'POST',
            body: formData,
        });
        expect(uploadRes.status).toBe(200);
        const uploadJson = (await uploadRes.json()) as any;
        expect(uploadJson.success).toBe(true);
        expect(uploadJson.filename).toBe('test.txt');

        // 2. List files via GET
        const listRes = await app.request('/files');
        expect(listRes.status).toBe(200);
        const listJson = (await listRes.json()) as any;
        expect(listJson.success).toBe(true);
        expect(listJson.files.length).toBeGreaterThanOrEqual(1);

        // 3. Download file via GET /files/test.txt
        const downloadRes = await app.request('/files/test.txt');
        expect(downloadRes.status).toBe(200);
        const content = await downloadRes.text();
        expect(content).toBe('Hello World');
        expect(downloadRes.headers.get('Content-Type')).toBe('text/plain');

        // 4. Delete file via DELETE
        const deleteRes = await app.request('/files/test.txt', { method: 'DELETE' });
        expect(deleteRes.status).toBe(204);

        // 5. Verify file is gone
        const download2 = await app.request('/files/test.txt');
        expect(download2.status).toBe(404);
    });

    it('should reject files exceeding max size', async () => {
        const kernel2 = new Kernel();
        kernel2.registerFeature(new StorageFeature({ adapter: 'local', basePath: TEST_DIR }));
        kernel2.registerFeature(
            new UploadFeature({
                projectName: 'size-test',
                exposeRoutes: true,
                authorize: () => true,
                maxFileSize: 10, // 10 bytes max
            }),
        );
        await kernel2.initialize();

        const app = kernel2.getApp();
        const feat = kernel2.getFeature('upload') as any;
        feat.routes(app);

        const formData = new FormData();
        formData.append('file', new File(['This is way too long for 10 bytes'], 'big.txt'));

        const res = await app.request('/upload', { method: 'POST', body: formData });
        expect(res.status).toBe(413);
        const json = (await res.json()) as any;
        expect(json.error).toContain('too large');

        await kernel2.shutdown();
    });

    it('should reject files with disallowed extensions', async () => {
        const kernel3 = new Kernel();
        kernel3.registerFeature(new StorageFeature({ adapter: 'local', basePath: TEST_DIR }));
        kernel3.registerFeature(
            new UploadFeature({
                projectName: 'ext-test',
                exposeRoutes: true,
                authorize: () => true,
                allowedExtensions: ['.txt', '.pdf'],
            }),
        );
        await kernel3.initialize();

        const app = kernel3.getApp();
        const feat = kernel3.getFeature('upload') as any;
        feat.routes(app);

        const formData = new FormData();
        formData.append('file', new File(['data'], 'script.exe'));

        const res = await app.request('/upload', { method: 'POST', body: formData });
        expect(res.status).toBe(400);
        const json = (await res.json()) as any;
        expect(json.error).toContain('extension');

        await kernel3.shutdown();
    });

    it('should return 400 when no file is provided', async () => {
        const kernel4 = new Kernel();
        kernel4.registerFeature(new StorageFeature({ adapter: 'local', basePath: TEST_DIR }));
        kernel4.registerFeature(
            new UploadFeature({
                projectName: 'no-file-test',
                exposeRoutes: true,
                authorize: () => true,
            }),
        );
        await kernel4.initialize();

        const app = kernel4.getApp();
        const feat = kernel4.getFeature('upload') as any;
        feat.routes(app);

        const formData = new FormData();
        // Don't append any file

        const res = await app.request('/upload', { method: 'POST', body: formData });
        expect(res.status).toBe(400);

        await kernel4.shutdown();
    });
});
