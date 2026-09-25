import { describe, expect, it } from 'bun:test';
import { createStorageAdapter } from '../src/factory';
import { LocalStorageAdapter } from '../src/adapters/local';
import { S3StorageAdapter } from '../src/adapters/s3';
import os from 'node:os';
import path from 'node:path';

describe('createStorageAdapter', () => {
    it('returns a LocalStorageAdapter for adapter: local', async () => {
        const adapter = await createStorageAdapter({
            adapter: 'local',
            basePath: path.join(os.tmpdir(), `factory-test-${process.pid}`),
        });
        expect(adapter).toBeInstanceOf(LocalStorageAdapter);
    });

    it('returns an S3StorageAdapter for adapter: s3', async () => {
        const adapter = await createStorageAdapter({
            adapter: 's3',
            connection: { region: 'us-east-1', bucket: 'b', accessKey: 'k', secretKey: 's' },
        });
        expect(adapter).toBeInstanceOf(S3StorageAdapter);
    });

    it('returns an S3StorageAdapter for adapter: minio', async () => {
        const adapter = await createStorageAdapter({
            adapter: 'minio',
            connection: {
                endpoint: 'http://localhost:9000',
                accessKey: 'k',
                secretKey: 's',
                bucket: 'b',
                useSSL: false,
            },
        });
        expect(adapter).toBeInstanceOf(S3StorageAdapter);
    });

    it('throws for an unsupported adapter value', async () => {
        await expect(createStorageAdapter({ adapter: 'gcs' as any })).rejects.toThrow('no soportado');
    });
});
