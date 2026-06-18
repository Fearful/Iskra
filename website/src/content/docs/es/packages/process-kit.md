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

El proceso corre en background de forma continua. Si `restartOnCrash: true`, se reinicia automaticamente si muere.

### `oneshot`

El proceso se ejecuta una vez y termina. Util para tareas de inicializacion o scripts de setup.

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

## Configuracion

```typescript
interface ProcessConfig {
    command: string;              // Comando a ejecutar
    args?: string[];              // Argumentos
    mode?: 'daemon' | 'oneshot' | 'stdio';  // default: 'daemon'
    restartOnCrash?: boolean;     // default: false
    env?: Record<string, string>; // Variables de entorno adicionales
}
```

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

El proceso se spawneea automaticamente al llamar `app.start()` y se termina con `app.stop()`.
