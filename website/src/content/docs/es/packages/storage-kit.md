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
// options: { contentType?, contentDisposition?, overwrite?, metadata? }
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
// options: { contentType?, contentDisposition? } que sirve la URL
const url = await storage.url(path, expiresIn?, options?);

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

### Tipo de contenido y disposicion

Un archivo se guarda y se sirve con un tipo tomado de su extension (`contentTypeFor`),
nunca con el tipo que envio quien lo subio: un archivo `.svg` o `.html` guardado como
`image/svg+xml` o `text/html` ejecuta sus scripts en el origen que lo sirve. Solo las
imagenes, PDF, texto, CSV, JSON, ZIP y las extensiones comunes de audio/video tienen
un tipo; cualquier otra, incluidas HTML, SVG, XML y JavaScript, es
`application/octet-stream`.

Solo las imagenes rasterizadas (PNG, JPEG, GIF, WebP, AVIF, BMP, ICO) se sirven
inline; todo lo demas es una descarga (`Content-Disposition: attachment`,
`dispositionFor`):

- S3/MinIO: `put()` guarda ese `Content-Disposition` con el objeto (pasa
  `contentDisposition` para elegir otro), y las URLs de `url()` se firman con el tipo
  y la disposicion de la extension de la ruta, sea cual sea el tipo con el que se
  guardo el objeto (pasa `{ contentType, contentDisposition }` para servir otra cosa).
- Local: `url()` devuelve `/storage/<ruta>`, una carpeta que sirve tu propia app.
  Sirvela con los mismos encabezados (`Content-Type: contentTypeFor(ruta)`,
  `Content-Disposition: dispositionFor(tipo)`, `X-Content-Type-Options: nosniff` e
  idealmente `Content-Security-Policy: sandbox`), no con el tipo que un servidor
  estatico deduce de la extension.

```typescript
import { contentTypeFor, dispositionFor } from '@iskra-bun/storage-kit';

contentTypeFor('logo.svg');    // 'application/octet-stream'
contentTypeFor('photo.png');   // 'image/png'
dispositionFor('image/png');   // 'inline'
dispositionFor('application/pdf'); // 'attachment'
```

### No sobrescribir un archivo

`put()` reemplaza el archivo que ya existe en la ruta. Con `overwrite: false` lanza
un `FileExistsError` en su lugar (`If-None-Match: *` en S3, una creacion exclusiva en
el disco local):

```typescript
import { FileExistsError } from '@iskra-bun/storage-kit';

try {
    await storage.put('docs/report.pdf', data, { overwrite: false });
} catch (error) {
    if (error instanceof FileExistsError) {
        // ya hay un archivo de otra persona en esa ruta
    }
}
```

En S3 esto requiere escrituras condicionales (AWS S3 desde agosto de 2024; comprueba
que tu MinIO o servidor compatible con S3 soporte `If-None-Match` en `PUT`).

### Endpoints S3 seguros por defecto

El adaptador de S3 rechaza un endpoint `http://` en texto plano para evitar enviar
credenciales y datos sin cifrar. El endpoint se analiza como una URL, igual que lo
hace el SDK de AWS, asi que `http:/host`, `http:host` o `http:\\host` tambien cuentan
como texto plano, y un endpoint que no es una URL `http(s)` se rechaza:

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
