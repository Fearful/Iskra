import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { FileExistsError } from '../src';
import { LocalStorageAdapter } from '../src/adapters/local';
import { S3StorageAdapter } from '../src/adapters/s3';

// put() always replaced the stored file, so the upload routes let any user
// allowed to upload overwrite anyone's file under the same name.

describe('put() with overwrite: false', () => {
    const dir = mkdtempSync(join(tmpdir(), 'storage-kit-no-overwrite-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('refuses to replace a local file, and still creates a new one', async () => {
        const storage = new LocalStorageAdapter({ adapter: 'local', basePath: dir });
        await storage.connect();
        await storage.put('p/report.pdf', new TextEncoder().encode('original'), { overwrite: false });

        const error = await storage
            .put('p/report.pdf', new TextEncoder().encode('replaced'), { overwrite: false })
            .catch((e) => e);
        expect(error).toBeInstanceOf(FileExistsError);
        expect(error.path).toBe('p/report.pdf');
        expect(new TextDecoder().decode((await storage.get('p/report.pdf'))!)).toBe('original');

        // The default still replaces.
        await storage.put('p/report.pdf', new TextEncoder().encode('replaced'));
        expect(new TextDecoder().decode((await storage.get('p/report.pdf'))!)).toBe('replaced');
    });

    it('sends If-None-Match: * to S3 and maps its 412 to FileExistsError', async () => {
        const adapter = new S3StorageAdapter({
            adapter: 's3',
            connection: { region: 'us-east-1', bucket: 'b', accessKey: 'AKID', secretKey: 'secret' },
        });
        (adapter as any).connected = true;
        const inputs: any[] = [];
        (adapter as any).client.send = async (cmd: any) => {
            if (cmd instanceof PutObjectCommand) inputs.push(cmd.input);
            if (cmd.input.IfNoneMatch === '*') {
                const err: any = new Error('At least one of the pre-conditions you specified did not hold');
                err.name = 'PreconditionFailed';
                err.$metadata = { httpStatusCode: 412 };
                throw err;
            }
            return {};
        };

        await adapter.put('p/report.pdf', new Uint8Array([1]));
        await expect(adapter.put('p/report.pdf', new Uint8Array([2]), { overwrite: false })).rejects.toBeInstanceOf(
            FileExistsError,
        );
        expect(inputs.map((i) => i.IfNoneMatch)).toEqual([undefined, '*']);
    });
});
