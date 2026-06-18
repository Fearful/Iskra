---
title: Process Kit
description: Management of external processes (Python, binaries, scripts) as sidecars.
---

Management of external processes (Python, binaries, scripts) as sidecars.

## Quick Start

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

## Execution Modes

### `daemon`

The process runs continuously in the background. If `restartOnCrash: true`, it automatically restarts if it dies.

### `oneshot`

The process runs once and terminates. Useful for initialization tasks or setup scripts.

### `stdio`

Bidirectional communication via stdin/stdout. The process receives and sends JSON:

```python
# scripts/worker.py
import sys, json

for line in sys.stdin:
    data = json.loads(line)
    result = {"processed": True, "input": data}
    print(json.dumps(result))
    sys.stdout.flush()
```

## Events

The ProcessManager emits these events on the App bus:

- `process:message` — parsed JSON message from the process stdout
- `process:log` — non-JSON log lines from the process
- `process:error` — when the process fails

## Configuration

```typescript
interface ProcessConfig {
    command: string;              // Comando a ejecutar
    args?: string[];              // Argumentos
    mode?: 'daemon' | 'oneshot' | 'stdio';  // default: 'daemon'
    restartOnCrash?: boolean;     // default: false
    env?: Record<string, string>; // Variables de entorno adicionales
}
```

## Example with Python

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

The process is spawned automatically when calling `app.start()` and is terminated with `app.stop()`.
