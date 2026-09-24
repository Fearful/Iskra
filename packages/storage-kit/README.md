# @iskra-bun/storage-kit

Almacenamiento de archivos de Iskra con adaptadores intercambiables para local, S3 y MinIO.

## Instalacion

```bash
bun add @iskra-bun/storage-kit @iskra-bun/core
```

## Uso rapido

```typescript
import { createStorageAdapter } from '@iskra-bun/storage-kit';

const storage = await createStorageAdapter({ adapter: 'local', basePath: './uploads' });
await storage.connect();

await storage.put('docs/readme.txt', Buffer.from('Hello'));
const bytes = await storage.get('docs/readme.txt');
const stream = await storage.getStream('docs/readme.txt');
```

Cambia `adapter: 's3'` o `adapter: 'minio'` para usar almacenamiento de objetos; la API es identica entre adaptadores.

## Documentacion

Guia completa: [@iskra-bun/storage-kit](https://iskra-docs.fly.dev/es/packages/storage-kit/)

## Licencia

AGPL-3.0-or-later
