# @iskra-bun/storage-kit

Almacenamiento de archivos con soporte para local, S3 y MinIO.

## Inicio Rapido

```typescript
import { createStorageAdapter } from '@iskra-bun/storage-kit';

const storage = await createStorageAdapter({
    adapter: 'local',
    basePath: './uploads',
});
await storage.connect();

// Guardar
const file = await storage.put('docs/hello.txt', Buffer.from('Hola'), {
    contentType: 'text/plain',
});

// Obtener bytes
const bytes = await storage.get('docs/hello.txt');

// Obtener stream
const stream = await storage.getStream('docs/hello.txt');

// Verificar existencia
const exists = await storage.exists('docs/hello.txt');

// Listar
const files = await storage.list('docs/');

// Eliminar
await storage.delete('docs/hello.txt');
```

## Adaptadores

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
// Guardar un archivo
const file = await storage.put(path, data, options?);

// Obtener bytes
const bytes = await storage.get(path);   // null si no existe

// Obtener ReadableStream
const stream = await storage.getStream(path);  // null si no existe

// Verificar existencia
const exists = await storage.exists(path);

// Listar archivos (recursivo)
const files = await storage.list(prefix?);

// Generar URL (pre-firmada en S3/MinIO, local en local)
const url = await storage.url(path, expiresIn?);

// Copiar
await storage.copy(from, to);

// Mover
await storage.move(from, to);

// Eliminar
await storage.delete(path);

// Verificar si es directorio
const isDir = await storage.isDirectory(path);
```

## Variables de Entorno

```bash
# S3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET=mi-bucket

# MinIO
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=mi-bucket
```
