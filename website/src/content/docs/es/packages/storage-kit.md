---
title: Storage Kit
description: Almacenamiento de archivos con adaptadores para local, S3 y MinIO.
---

Almacenamiento de archivos con adaptadores para el sistema de archivos local, Amazon S3 y MinIO.

## Inicio Rapido

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

Un endpoint `http://` en texto plano se rechaza al construir el adaptador, salvo
que lo habilites de forma explicita con `useSSL: false` (ver [Seguridad](#seguridad)).

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

// Leer bytes
const bytes = await storage.get(path);         // null si no existe

// Leer como ReadableStream
const stream = await storage.getStream(path);  // null si no existe

// Verificar existencia
const exists = await storage.exists(path);

// Listar los archivos de una carpeta y sus subcarpetas
const files = await storage.list(prefix?);

// Generar URL (pre-firmada para S3/MinIO)
const url = await storage.url(path, expiresIn?);

// Copiar
await storage.copy(from, to);

// Mover
await storage.move(from, to);

// Eliminar
await storage.delete(path);

// Verificar si la ruta es un directorio
const isDir = await storage.isDirectory(path);
```

## Seguridad

### Proteccion contra path traversal

Las claves de objeto se sanean antes de cualquier operacion de E/S: las barras
invertidas se normalizan a `/`, y los segmentos vacios o compuestos solo por puntos
(`.`, `..`, `....`) se eliminan. Ademas, el adaptador local resuelve la ruta final
y verifica que permanezca dentro de `basePath`. Cualquier clave que intente escapar
de la raiz de almacenamiento lanza un error:

```typescript
await storage.put('../../etc/passwd', data);
// Error: Path escapes storage root: ../../etc/passwd
```

Como las claves nunca pueden escapar de `basePath`, es seguro pasar claves derivadas
del usuario directamente a `put`, `get`, `getStream`, `delete` y los demas metodos.
Aun asi, se recomienda validar el formato de las claves en el limite de tu
aplicacion como defensa en profundidad.

### Endpoints S3 seguros por defecto

El adaptador de S3 rechaza un endpoint `http://` en texto plano para evitar enviar
credenciales y datos sin cifrar:

```typescript
new S3StorageAdapter({
    adapter: 'minio',
    connection: { endpoint: 'http://insecure.example.com:9000', /* ... */ },
});
// Error: Refusing plaintext S3 endpoint; set useSSL:false to override
```

Los endpoints `https://` funcionan sin ningun flag adicional. Para usar un endpoint
en texto plano a proposito (por ejemplo, una instancia local de MinIO), habilitalo
de forma explicita:

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

### Nombres de archivo generados impredecibles

Cuando el kit genera un nombre de archivo, el componente aleatorio proviene de una
fuente criptograficamente fuerte (`crypto.randomUUID()`), no de `Math.random()`, de
modo que los nombres generados no pueden predecirse ni enumerarse.

## Variables de Entorno

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
