import { describe, expect, it, afterAll } from 'bun:test';
import { Kernel } from '../src/kernel';
import { StorageFeature } from '../src/features/storage';
import fs from 'node:fs/promises';
import path from 'node:path';

const TEST_DIR = path.join(process.cwd(), 'test-storage');

describe('Storage Feature', () => {
    it('should init and manipulate files', async () => {
        const kernel = new Kernel();
        const storage = new StorageFeature({
            adapter: 'local',
            basePath: TEST_DIR,
        });

        kernel.registerFeature(storage);
        await kernel.initialize();

        const app = kernel.getApp();
        expect(app).toBeDefined();

        // Test usage via helper/adapter (simulating context usage)
        const adapter = (storage as any).adapter; // Access private adapter for test

        const testFile = 'hello.txt';
        const content = Buffer.from('Hello World');

        await adapter.put(testFile, content, { contentType: 'text/plain' });

        const exists = await adapter.exists(testFile);
        expect(exists).toBe(true);

        const readContent = await adapter.get(testFile);
        expect(new TextDecoder().decode(readContent)).toBe('Hello World');

        await adapter.delete(testFile);
        const existsAfter = await adapter.exists(testFile);
        expect(existsAfter).toBe(false);

        await kernel.shutdown();
    });

    afterAll(async () => {
        try {
            await fs.rm(TEST_DIR, { recursive: true, force: true });
        } catch {
            /* ignored */
        }
    });
});
