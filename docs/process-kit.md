# @iskra-bun/process-kit

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

El proceso corre en background de forma continua. Si `restartOnCrash: true`, se reinicia automaticamente si muere.

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

## Eventos

El ProcessManager emite estos eventos en el bus de la App:

- `process:message` — mensaje JSON parseado del stdout del proceso
- `process:log` — lineas de log no-JSON del proceso
- `process:error` — cuando el proceso falla

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

Lanza un error si ya existe un proceso con ese nombre. Usa `kill()` primero si necesitas reemplazarlo.

### `kill(name, gracefulTimeoutMs?)`

Detiene de forma ordenada un proceso por nombre: envia **SIGTERM** y escala a **SIGKILL** si el proceso no ha terminado dentro de `gracefulTimeoutMs` (por defecto `5000` ms).

```typescript
await pm.kill('extra-worker');
// o con un timeout personalizado:
await pm.kill('extra-worker', 2000);
```

Lanza un error si no existe ningun proceso con ese nombre.

## Parada Ordenada

`stop()` (llamado automaticamente por `app.stop()`) envia **SIGTERM** a todos los procesos en paralelo y escala a **SIGKILL** tras el timeout. El timeout por defecto es `5000` ms.

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
    env?: Record<string, string>;  // Variables de entorno adicionales
    restartBackoff?: {
        initialMs: number;         // Retraso antes del primer reinicio
        maxMs: number;             // Limite maximo del retraso
        factor: number;            // Multiplicador aplicado tras cada crash
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
