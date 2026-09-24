---
title: KV Kit
description: Store de key-value con soporte para Redis y memoria.
---

Store de key-value con soporte para Redis y memoria.

## Inicio Rapido

```typescript
import { App } from '@iskra-bun/core';
import { KVManager } from '@iskra-bun/kv-kit';

const app = new App({
    name: 'MiApp',
    kv: {
        driver: 'redis',
        connection: { url: 'redis://localhost:6379' },
    },
});

const kv = new KVManager();
app.register(kv);

await app.start();

// Usar el store
await kv.set('usuario:123', { name: 'Juan', role: 'admin' });
const user = await kv.get('usuario:123');
await kv.del('usuario:123');
```

## Adapters

### Memory (default)

Si no configuras nada, usa el adapter de memoria:

```typescript
const app = new App({ name: 'MiApp' });
const kv = new KVManager(); // usa memoria por defecto
```

### Redis

`connection` se pasa directamente al cliente `ioredis`, por lo que acepta tanto un objeto de opciones (`RedisOptions`) como una cadena de conexión:

```typescript
const app = new App({
    name: 'MiApp',
    kv: {
        driver: 'redis',
        connection: { url: process.env.REDIS_URL || 'redis://localhost:6379' },
    },
});

// O una cadena de conexión:
const app = new App({
    name: 'MiApp',
    kv: { driver: 'redis', connection: 'redis://localhost:6379' },
});
```

## API

```typescript
// Guardar (con TTL opcional en segundos)
await kv.set('clave', valor);
await kv.set('clave', valor, 60); // expira en 60 segundos

// Obtener — devuelve undefined si la clave no existe
const data = await kv.get('clave');

// Eliminar
await kv.del('clave');

// Verificar existencia
const existe = await kv.has('clave');
```

### Cliente nativo de Redis

Con el driver `redis`, `kv.client` es el cliente de [ioredis](https://github.com/redis/ioredis)
(despues de `app.start()`) para comandos que la API KV no cubre (sets, sorted sets,
pipelines). No aplica el `namespace` ni el codec JSON. Es `undefined` con el driver
`memory`. El `KVManager` tambien queda registrado en el contexto de la app:

```typescript
const kv = app.context.get('kv'); // el KVManager
await kv.client?.sadd('tags', 'a', 'b');
```

## Valores Genéricos (Tipados)

`get` y `set` aceptan un parámetro de tipo para obtener lecturas tipadas en lugar de `any`:

```typescript
interface Usuario {
    nombre: string;
    rol: string;
}

// Escritura tipada
await kv.set<Usuario>('usuario:123', { nombre: 'Juan', rol: 'admin' });

// Lectura tipada — resuelve a Usuario | undefined
const usuario = await kv.get<Usuario>('usuario:123');
if (usuario) {
    console.log(usuario.rol); // string, no any
}
```

Una clave inexistente resuelve a `undefined` (no `null`). Anteriormente el adaptador Redis podía devolver `null` para claves inexistentes; ahora está normalizado en todos los adaptadores.

## Codec de Valores en Redis

El adaptador de Redis usa un único codec consistente para cada escritura y lectura: los valores se serializan con `JSON.stringify` al escribir y se parsean con `JSON.parse` al leer. Esto preserva los tipos de JavaScript, igual que el adaptador de memoria:

```typescript
await kv.set('numerica', '123'); // string
typeof (await kv.get('numerica')); // 'string' — NO se convierte en número 123

await kv.set('jsonish', '{}');    // string
await kv.get('jsonish');          // '{}' — sigue siendo string, NO un objeto vacío

await kv.set('contador', 42);     // number
typeof (await kv.get('contador')); // 'number'
```

`undefined` se trata de forma explícita (se almacena como el literal JSON `null` y se decodifica de vuelta a `undefined`), por lo que nunca se corrompe en la cadena `"undefined"`. Valores escritos fuera del adaptador que no sean JSON válido se devuelven tal cual (como cadena).

## Namespace

Pasa la opción `namespace` para prefixar automáticamente cada clave y evitar colisiones entre módulos que comparten el mismo store:

```typescript
const sesiones = new KVManager({ namespace: 'sessions' });
const cache    = new KVManager({ namespace: 'cache' });

// Escriben en "sessions:token" y "cache:token" — sin colisión
await sesiones.set('token', datosSesion);
await cache.set('token', respuestaCache);
```

El prefijo se aplica de forma transparente; nunca lo incluyes en tus cadenas de clave. La opción tiene como valor predeterminado `""` (sin prefijo) para que el código existente no se vea afectado.

## Operaciones en Lote

`KVManager` expone tres helpers de lote que ejecutan sus llamadas subyacentes de forma concurrente:

```typescript
// Leer varias claves a la vez — preserva el orden, undefined para claves inexistentes
const [a, b, c] = await kv.mget<string>(['clave:a', 'clave:b', 'clave:c']);

// Escribir varios pares clave/valor (TTL compartido opcional)
await kv.mset({ 'clave:a': 'alfa', 'clave:b': 'beta' });
await kv.mset([['clave:c', 'gamma'], ['clave:d', 'delta']], 120); // TTL = 120 s

// Eliminar varias claves
await kv.mdel(['clave:a', 'clave:b', 'clave:c']);
```

`mset` acepta tanto un array de tuplas `[clave, valor]` como un objeto plano.

## TTL y el Adaptador de Memoria

El adaptador en memoria gestiona los temporizadores de expiración sin fugas: sobrescribir una clave con una nueva llamada a `set` cancela cualquier temporizador previo antes de programar uno nuevo, por lo que un temporizador obsoleto nunca puede eliminar un valor recién escrito.

## Variables de Entorno

```bash
REDIS_URL=redis://localhost:6379
```
