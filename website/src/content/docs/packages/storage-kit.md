---
title: Storage Kit
description: File storage with adapters for local, S3 and MinIO.
---

File storage with adapters for local filesystem, Amazon S3, and MinIO.

## Quick Start

```typescript
import { createStorageAdapter } from '@iskra-bun/storage-kit';

const storage = await createStorageAdapter({
    adapter: 'local',
    basePath: './uploads',
});
await storage.connect();

const file = await storage.put('docs/hello.txt', Buffer.from('Hello'));
const bytes = await storage.get('docs/hello.txt');
const stream = await storage.getStream('docs/hello.txt');
```

## Adapters

### Local

```typescript
const storage = await createStorageAdapter({
    adapter: 'local',
    basePath: './uploads',
});
```

### S3

```typescript
const storage = await createStorageAdapter({
    adapter: 's3',
    connection: {
        region: process.env.AWS_REGION,
        accessKey: process.env.AWS_ACCESS_KEY_ID,
        secretKey: process.env.AWS_SECRET_ACCESS_KEY,
        bucket: process.env.S3_BUCKET,
    },
});
```

A plaintext `http://` endpoint is refused at construction time unless you opt in
explicitly with `useSSL: false` (see [Security](#security)).

### MinIO

```typescript
const storage = await createStorageAdapter({
    adapter: 'minio',
    connection: {
        endpoint: process.env.MINIO_ENDPOINT,
        accessKey: process.env.MINIO_ACCESS_KEY,
        secretKey: process.env.MINIO_SECRET_KEY,
        bucket: process.env.MINIO_BUCKET,
    },
});
```

## API

```typescript
// Store a file
const file = await storage.put(path, data, options?);

// Read bytes
const bytes = await storage.get(path);         // null if not found

// Read as ReadableStream
const stream = await storage.getStream(path);  // null if not found

// Check existence
const exists = await storage.exists(path);

// List the files in a folder and its subfolders
const files = await storage.list(prefix?);

// Generate URL (pre-signed for S3/MinIO)
const url = await storage.url(path, expiresIn?);

// Copy
await storage.copy(from, to);

// Move
await storage.move(from, to);

// Delete
await storage.delete(path);

// Check if path is a directory
const isDir = await storage.isDirectory(path);
```

## Security

### Path traversal protection

Object keys are sanitized before any I/O: backslashes are normalized to `/`, and
empty or dot-only segments (`.`, `..`, `....`) are stripped. On top of that, the
local adapter resolves the final path and verifies it stays inside `basePath`. Any
key that would escape the storage root throws:

```typescript
await storage.put('../../etc/passwd', data);
// Error: Path escapes storage root: ../../etc/passwd
```

Because keys can never escape `basePath`, it is safe to pass user-derived keys
directly to `put`, `get`, `getStream`, `delete`, and the other methods. Validating
the shape of keys at your application boundary is still recommended as defense in
depth.

### Secure-by-default S3 endpoints

The S3 adapter refuses a plaintext `http://` endpoint to avoid sending credentials
and data in the clear:

```typescript
new S3StorageAdapter({
    adapter: 'minio',
    connection: { endpoint: 'http://insecure.example.com:9000', /* ... */ },
});
// Error: Refusing plaintext S3 endpoint; set useSSL:false to override
```

`https://` endpoints work without any extra flag. To use a plaintext endpoint on
purpose (for example, a local MinIO instance), opt in explicitly:

```typescript
const storage = await createStorageAdapter({
    adapter: 'minio',
    connection: {
        endpoint: 'http://localhost:9000',
        accessKey: process.env.MINIO_ACCESS_KEY,
        secretKey: process.env.MINIO_SECRET_KEY,
        bucket: process.env.MINIO_BUCKET,
        useSSL: false,
    },
});
```

### Unguessable generated filenames

When the kit generates a filename, the random component comes from a
cryptographically strong source (`crypto.randomUUID()`), not `Math.random()`, so
generated names cannot be predicted or enumerated.

## Environment Variables

```bash
# S3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET=my-bucket

# MinIO
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=my-bucket
```
