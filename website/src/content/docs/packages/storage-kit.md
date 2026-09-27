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
// options: { contentType?, contentDisposition?, overwrite?, metadata?, maxBytes? }
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
// options: { contentType?, contentDisposition? } served by the URL
const url = await storage.url(path, expiresIn?, options?);

// Copy
await storage.copy(from, to);

// Move
await storage.move(from, to);

// Delete
await storage.delete(path);

// Check if path is a directory
const isDir = await storage.isDirectory(path);
```

`PutOptions.public` is deprecated and ignored by every adapter: to make objects
public, use a bucket policy (S3/MinIO) or serve them from your app (local).

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

### Content type and disposition

A file is stored and served with a type taken from its extension (`contentTypeFor`),
never with the type an uploader sent: an `.svg` or `.html` file stored as
`image/svg+xml` or `text/html` runs its scripts on the origin that serves it. Only
images, PDF, text, CSV, JSON, ZIP and common audio/video extensions have a type;
anything else, including HTML, SVG, XML and JavaScript, is `application/octet-stream`.

Only raster images (PNG, JPEG, GIF, WebP, AVIF, BMP, ICO) are served inline;
everything else is a download (`Content-Disposition: attachment`, `dispositionFor`):

- S3/MinIO: `put()` stores that `Content-Disposition` with the object (pass
  `contentDisposition` to choose another), and the URLs of `url()` are signed with
  the type and disposition of the path's extension, whatever the object was stored
  with (pass `{ contentType, contentDisposition }` to serve something else).
- Local: `url()` returns `/storage/<path>`, a folder your app serves itself. Serve it
  with the same headers (`Content-Type: contentTypeFor(path)`,
  `Content-Disposition: dispositionFor(type)`, `X-Content-Type-Options: nosniff`,
  ideally `Content-Security-Policy: sandbox`), not with the type a static server
  infers from the extension.

```typescript
import { contentTypeFor, dispositionFor } from '@iskra-bun/storage-kit';

contentTypeFor('logo.svg');    // 'application/octet-stream'
contentTypeFor('photo.png');   // 'image/png'
dispositionFor('image/png');   // 'inline'
dispositionFor('application/pdf'); // 'attachment'
```

### Not overwriting a file

`put()` replaces a file already stored at the path. With `overwrite: false` it
throws a `FileExistsError` instead (S3 `If-None-Match: *`, an exclusive create on
the local disk):

```typescript
import { FileExistsError } from '@iskra-bun/storage-kit';

try {
    await storage.put('docs/report.pdf', data, { overwrite: false });
} catch (error) {
    if (error instanceof FileExistsError) {
        // someone else's file is already there
    }
}
```

On S3 this needs conditional writes (AWS S3 since August 2024; check your MinIO
or S3-compatible server supports `If-None-Match` on `PUT`).

### Streamed uploads to S3

The S3/MinIO adapter reads a `ReadableStream` given to `put()` into memory before
uploading it. `maxBytes` bounds that: a longer stream is cancelled and `put()`
rejects with a `RangeError` (`put(): stream exceeds maxBytes (N)`) without
uploading anything. The default is 5 GiB, S3's limit for a single upload (or the
largest Buffer the runtime allows, if smaller); set it to what the route accepts
when the stream comes from a request body. It must be a non-negative integer
(else `put()` rejects with a `TypeError` or `RangeError`). Chunks may be bytes
(any `ArrayBuffer` view), `ArrayBuffer`s or strings, stored as UTF-8 and counted
by their UTF-8 bytes. The local
adapter writes a stream straight to disk and ignores `maxBytes`: bound the size
before calling it.

```typescript
await storage.put('uploads/avatar.png', req.body!, { maxBytes: 5 * 1024 * 1024 });
```

### Secure-by-default S3 endpoints

The S3 adapter refuses a plaintext `http://` endpoint to avoid sending credentials
and data in the clear. The endpoint is parsed as a URL, as the AWS SDK parses it,
so `http:/host`, `http:host` or `http:\\host` count as plaintext too, and an
endpoint that is not an `http(s)` URL is rejected:

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
