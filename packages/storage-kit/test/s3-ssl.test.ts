import { describe, expect, it } from 'bun:test';
import { S3StorageAdapter } from '../src/adapters/s3';

// Covers: MEDIUM S3 useSSL no-op (src/adapters/s3.ts; config at src/base.ts).
// Fix expectation: connection.useSSL must be honored. A plaintext http:// endpoint
// must be refused unless the caller explicitly opts in with useSSL:false.
// Error: "Refusing plaintext S3 endpoint; set useSSL:false to override".

describe('S3StorageAdapter - useSSL enforcement', () => {
    it('refuses a plaintext http endpoint when useSSL is not set', () => {
        expect(
            () =>
                new S3StorageAdapter({
                    adapter: 's3',
                    connection: {
                        endpoint: 'http://insecure.example.com:9000',
                        accessKey: 'x',
                        secretKey: 'x',
                        bucket: 'b',
                    },
                }),
        ).toThrow(/Refusing plaintext S3 endpoint/i);
    });

    it('refuses a plaintext http endpoint when useSSL is explicitly true', () => {
        expect(
            () =>
                new S3StorageAdapter({
                    adapter: 's3',
                    connection: {
                        endpoint: 'http://insecure.example.com:9000',
                        accessKey: 'x',
                        secretKey: 'x',
                        bucket: 'b',
                        useSSL: true,
                    },
                }),
        ).toThrow(/Refusing plaintext S3 endpoint/i);
    });

    it('allows a plaintext http endpoint when useSSL is explicitly false', () => {
        expect(
            () =>
                new S3StorageAdapter({
                    adapter: 'minio',
                    connection: {
                        endpoint: 'http://localhost:9000',
                        accessKey: 'x',
                        secretKey: 'x',
                        bucket: 'b',
                        useSSL: false,
                    },
                }),
        ).not.toThrow();
    });

    it('allows an https endpoint without requiring useSSL', () => {
        expect(
            () =>
                new S3StorageAdapter({
                    adapter: 's3',
                    connection: {
                        endpoint: 'https://secure.example.com',
                        accessKey: 'x',
                        secretKey: 'x',
                        bucket: 'b',
                    },
                }),
        ).not.toThrow();
    });
});
