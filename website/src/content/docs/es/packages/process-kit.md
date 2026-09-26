---
title: Process Kit
description: Gestion de procesos externos (Python, binarios, scripts) como sidecars.
---

Gestion de procesos externos (Python, binarios, scripts) como sidecars.

## Inicio Rapido

```typescript
import { App } from '@iskra-bun/core';
import { ProcessManager } from '@iskra-bun/process-kit';

const app = new App({
    name: 'MiApp',
    processes: {
        'python-worker': {
            command: 'python3',
            args: ['scripts/worker.py'],
            mode: 'daemon',
            restartOnCrash: true,
        },
        'data-transform': {
            command: 'python3',
            args: ['scripts/transform.py'],
            mode: 'stdio',
        },
    },
});

const pm = new ProcessManager();
app.register(pm);

// Escuchar mensajes del proceso
app.on('process:message', async (ctx) => {
    console.log('Mensaje del proceso:', ctx.payload);
});

await app.start();
```

## Modos de Ejecucion

### `daemon`

El proceso corre en background de forma continua. Si `restartOnCrash: true`, se reinicia automaticamente cuando falla (codigo de salida distinto de 0 o muerto por una senal); una salida limpia con codigo 0 no se reinicia.

Cada proceso se lanza en su propio grupo de procesos, asi que `kill()` y `stop()` envian las senales a todo el arbol: los hijos de un wrapper (`sh -c`, `npm run`, un script) tambien terminan. Esperan a que no quede ningun proceso del grupo, y le envian SIGKILL al grupo si algo sigue vivo pasado el timeout (un nieto que ignora SIGTERM, por ejemplo). Cuando un proceso falla, lo que dejo corriendo en su grupo se termina antes de reiniciarlo. Un `kill()` mientras el proceso espera su backoff de reinicio cancela ese reinicio. Como los grupos son propios, el Ctrl-C de la terminal no les llega: si la app sale antes de que `stop()` termine con ellos (el `shutdownTimeoutMs` del App, una segunda senal, cualquier `process.exit()`), a cada grupo que siga vivo se le envia SIGKILL al salir, asi que ningun hijo sobrevive a la app.

Si un proceso no se puede lanzar (no existe su comando, por ejemplo), `spawn()` falla. En `app.start()` no hace fallar la app: se informa con `process:spawn-error` y, con `restartOnCrash`, se reintenta con el backoff de reinicio, igual que un reinicio que no lo puede lanzar; cada intento fallido cuenta para `maxRestarts`.

### `oneshot`

El proceso se ejecuta una vez y termina. Util para tareas de inicializacion o scripts de setup. Los procesos `oneshot` **nunca se reinician**, aunque `restartOnCrash: true` este configurado. Se emite el evento `process:exit` cuando finalizan.

### `stdio`

Comunicacion bidireccional via stdin/stdout. El proceso recibe y envia JSON:

```python
# scripts/worker.py
import sys, json

for line in sys.stdin:
    data = json.loads(line)
    result = {"processed": True, "input": data}
    print(json.dumps(result))
    sys.stdout.flush()
```

El protocolo es un mensaje por linea. `processManager.send(name, data)` codifica un objeto como JSON; un string se escribe tal cual, asi que uno con un salto de linea se rechaza (el hijo lo leeria como varios mensajes). Una linea de stdout de mas de 1 MiB se emite truncada como `process:log`, y el resto se descarta en vez de leerse como mensaje. Los argumentos solo se registran en nivel `debug`.

`send()` resuelve `true` cuando el mensaje se escribio o quedo en cola, y `false`, con un warning, cuando no se envio: un proceso que no existe, uno que no esta en modo `stdio`, un string con un salto de linea, o un hijo que no esta leyendo su stdin. Lo que el pipe no acepta espera en la memoria de la app, asi que `send()` rechaza un mensaje cuando los bytes que siguen esperando a ese hijo superarian `maxPendingStdinBytes` (8 MiB por defecto). Un mensaje siempre se acepta cuando no hay nada esperando, y se registra un solo warning hasta que el hijo se pone al dia. Cuando quien llama espera la respuesta del hijo (un request HTTP reenviado a un script, por ejemplo), revisa el resultado para que falle en el acto en vez de esperar su timeout:

```typescript
if (!(await pm.send('processor', { requestId, data }))) {
    return c.json({ error: 'Processor busy' }, 503);
}
```

## Entorno

Un hijo no hereda todo el entorno de la app. Por defecto recibe las variables que los programas necesitan para correr, que no llevan secretos (`PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `TERM`, `LANG`, `LANGUAGE`, `LC_*`, `TZ`, `TMPDIR`, `TMP`, `TEMP` y `NODE_ENV`; en Windows tambien `SYSTEMROOT`, `WINDIR`, `COMSPEC`, `PATHEXT` y `USERPROFILE`), mas las que se definen en `env`. `DATABASE_URL`, `AUTH_SECRET`, las credenciales de la nube y lo que se cargo de `.env` quedan en la app, asi que un hijo que corre codigo de terceros (un paquete de Python, un plugin, un script de un usuario) no puede leerlos.

```typescript
processes: {
    etl: {
        command: 'python3',
        args: ['etl.py'],
        inheritEnv: ['DATABASE_URL', 'HTTPS_PROXY'], // tambien estas, del entorno de la app
        env: { ETL_BATCH_SIZE: '500' },              // definida solo para este hijo
    },
},
```

`inheritEnv: true` pasa el entorno completo.

> **Breaking (0.x):** antes los hijos heredaban todas las variables de la app. Un hijo que lee una de su entorno (`os.environ['DATABASE_URL']`, por ejemplo) ahora necesita que este listada en `inheritEnv` o definida en `env`; `inheritEnv: true` vuelve al comportamiento anterior.

## Eventos

El ProcessManager emite estos eventos en el bus de la App:

- `process:message` — mensaje JSON parseado del stdout del proceso
- `process:log` — lineas de log no-JSON del proceso (tambien la ultima, aunque no termine en salto de linea)
- `process:error` — cada linea que el proceso escribe en stderr (modo `stdio`)
- `process:exit` — cuando un proceso termina por su cuenta (no despues de `kill()` o `stop()`): `{ name, exitCode, signal }` (`exitCode` es `null` si lo mato una senal)
- `process:spawn-error` — cuando un proceso no se pudo lanzar en `app.start()` o en un reinicio: `{ name, error }`
- `process:max-restarts` — cuando se supera `maxRestarts`

## Gestion de Procesos en Tiempo de Ejecucion

Despues de `app.start()` puedes agregar o eliminar procesos individuales sin reiniciar toda la aplicacion.

### `spawn(name, config)`

Inicia un nuevo proceso en tiempo de ejecucion con el mismo formato de configuracion que el mapa `processes` del arranque.

```typescript
const pm = new ProcessManager();
// ... registrar e iniciar la app ...

await pm.spawn('extra-worker', {
    command: 'python3',
    args: ['scripts/extra.py'],
    mode: 'stdio',
    restartOnCrash: true,
});
```

Lanza un error si ya existe un proceso con ese nombre. Usa `kill()` primero si necesitas reemplazarlo. Tambien lanza un error si su App todavia no inicializo el manager (`ProcessManager is not initialized: register it on an App first`) o despues de `stop()` (`ProcessManager is stopped`); antes se resolvia sin lanzar nada.

### `kill(name, gracefulTimeoutMs?)`

Detiene de forma ordenada un proceso por nombre: envia **SIGTERM** y escala a **SIGKILL** si el proceso no ha terminado dentro de `gracefulTimeoutMs` (por defecto `5000` ms).

```typescript
await pm.kill('extra-worker');
// o con un timeout personalizado:
await pm.kill('extra-worker', 2000);
```

Lanza un error si no existe ningun proceso con ese nombre.

> **Espera en el peor caso.** Tras enviar SIGTERM, `kill()` espera hasta `gracefulTimeoutMs` antes de escalar a SIGKILL, y despues otorga otra ventana de gracia para que el proceso termine. Por eso la espera maxima antes de que `kill()` (o `stop()`) resuelva es de hasta **~2x `gracefulTimeoutMs`**. Si el proceso sobrevive a **ambas** senales (SIGTERM y SIGKILL), no se descarta en silencio: se registra como huerfano via `app.logger.error` para que la fuga sea observable y puedas hacer limpieza manual.

## Parada Ordenada

`stop()` (llamado automaticamente por `app.stop()`) envia **SIGTERM** a todos los procesos en paralelo y escala a **SIGKILL** tras el timeout. El timeout por defecto es `5000` ms. Al igual que `kill()`, la espera maxima por proceso es de hasta **~2x `gracefulTimeoutMs`**, y cualquier proceso que sobreviva a ambas senales se registra como huerfano via `app.logger.error`.

```typescript
await app.stop(); // o: await pm.stop(3000) para un timeout de 3 s
```

## Configuracion

```typescript
interface ProcessConfig {
    command: string;               // Ejecutable a lanzar
    args?: string[];               // Argumentos
    mode?: 'daemon' | 'oneshot' | 'stdio';  // default: 'daemon'
    restartOnCrash?: boolean;      // default: false
    maxRestarts?: number;          // default: 10
    restartCooldown?: number;      // ms; si el uptime supera este valor, el contador se reinicia. default: 60000
    env?: Record<string, string>;  // Variables definidas para el hijo
    inheritEnv?: boolean | string[]; // Variables de la app que hereda el hijo: un conjunto minimo por defecto (ver Entorno), una lista agrega nombres, true = todas
    maxPendingStdinBytes?: number; // stdio: bytes que send() deja esperando a un hijo que no lee. default: 8 MiB
    restartBackoff?: {
        initialMs?: number;        // Retraso antes del primer reinicio. default: 1000
        maxMs?: number;            // Limite maximo del retraso. default: 30000
        factor?: number;           // Multiplicador aplicado tras cada reinicio. default: 2
    };
}
```

Cuando `restartBackoff` **no** esta configurado, el retraso de reinicio es fijo en **1000 ms** (comportamiento anterior). Cuando se configura, el retraso crece exponencialmente tras cada crash y se reinicia a `initialMs` si el proceso permanece activo mas tiempo que `restartCooldown`.

## Ejemplo con Python

```typescript
// app.config.ts
export default {
    name: 'DataProcessor',
    processes: {
        processor: {
            command: 'python3',
            args: ['src/scripts/process.py'],
            mode: 'stdio',
        },
    },
};
```

El proceso se spawnea automaticamente al llamar `app.start()` y se termina con `app.stop()`.

### Ejemplo con Backoff de Reinicio

Un proceso que crashea repetidamente retrocede exponencialmente en lugar de saturar el sistema:

```typescript
const pm = new ProcessManager();

await pm.spawn('servicio-inestable', {
    command: './bin/servicio-inestable',
    mode: 'daemon',
    restartOnCrash: true,
    maxRestarts: 8,
    restartBackoff: {
        initialMs: 500,   // primer reinicio tras 500 ms
        maxMs: 30000,     // limite en 30 s
        factor: 2,        // 500 → 1000 → 2000 → 4000 → ...
    },
    restartCooldown: 120000, // considerar estable tras 2 min de uptime; reiniciar contador
});
```
