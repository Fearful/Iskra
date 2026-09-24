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

The process runs continuously in the background. With `restartOnCrash: true` it is restarted when it fails (non-zero exit code or killed by a signal); a clean exit with code 0 is not restarted.

Each process is started in its own process group, so `kill()` and `stop()` signal the whole tree: the children of a wrapper (`sh -c`, `npm run`, a script) are terminated too. A `kill()` while the process waits out its restart backoff cancels that restart.

### `oneshot`

The process runs once and terminates. Useful for initialization tasks or setup scripts. `oneshot` processes are **never restarted**, even if `restartOnCrash: true` is set. A `process:exit` event is emitted when they finish.

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
- `process:log` — non-JSON log lines from the process (including a last line without a trailing newline)
- `process:error` — each line the process writes to stderr (`stdio` mode)
- `process:exit` — whenever a process exits: `{ name, exitCode, signal }` (`exitCode` is `null` when a signal killed it)
- `process:max-restarts` — when `maxRestarts` is exceeded

## Runtime Process Management

After `app.start()` you can add or remove individual processes without restarting the whole app.

### `spawn(name, config)`

Spawns a new process at runtime using the same config format as the boot-time `processes` map.

```typescript
const pm = new ProcessManager();
// ... register and start app ...

await pm.spawn('extra-worker', {
    command: 'python3',
    args: ['scripts/extra.py'],
    mode: 'stdio',
    restartOnCrash: true,
});
```

Throws if a process with that name is already running. Use `kill()` first if you need to replace one.

### `kill(name, gracefulTimeoutMs?)`

Gracefully stops a single named process: sends **SIGTERM** and escalates to **SIGKILL** after `gracefulTimeoutMs` (default `5000` ms) if the process has not exited.

```typescript
await pm.kill('extra-worker');
// or with a custom timeout:
await pm.kill('extra-worker', 2000);
```

Throws if no process with that name exists.

> **Worst-case wait.** After sending SIGTERM, `kill()` waits up to `gracefulTimeoutMs` before escalating to SIGKILL, then allows a further grace window for the process to actually exit. As a result the maximum wait before `kill()` (or `stop()`) resolves is up to **~2x `gracefulTimeoutMs`**. If the process survives **both** signals (SIGTERM and SIGKILL), it is not dropped silently: it is logged as an orphan via `app.logger.error` so the leak is observable and you can clean it up manually.

## Graceful Shutdown

`stop()` (called automatically by `app.stop()`) sends **SIGTERM** to all running processes in parallel and escalates to **SIGKILL** after the timeout. The default timeout is `5000` ms. Like `kill()`, the per-process worst-case wait is up to **~2x `gracefulTimeoutMs`**, and any process that survives both signals is logged as an orphan via `app.logger.error`.

```typescript
await app.stop(); // or: await pm.stop(3000) for a 3 s timeout
```

## Configuration

```typescript
interface ProcessConfig {
    command: string;               // Executable to run
    args?: string[];               // Arguments
    mode?: 'daemon' | 'oneshot' | 'stdio';  // default: 'daemon'
    restartOnCrash?: boolean;      // default: false
    maxRestarts?: number;          // default: 10
    restartCooldown?: number;      // ms; if process uptime exceeds this, restart counter resets. default: 60000
    env?: Record<string, string>;  // Additional environment variables
    restartBackoff?: {
        initialMs?: number;        // Delay before first restart. default: 1000
        maxMs?: number;            // Maximum delay cap. default: 30000
        factor?: number;           // Multiplier applied after each restart. default: 2
    };
}
```

When `restartBackoff` is **not** set, the restart delay is a flat **1000 ms** (previous behaviour). When set, the delay grows exponentially after each crash and resets to `initialMs` once the process stays up longer than `restartCooldown`.

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

### Restart Backoff Example

A crash-looping process will back off exponentially instead of hammering the system:

```typescript
const pm = new ProcessManager();

await pm.spawn('flaky-service', {
    command: './bin/flaky-service',
    mode: 'daemon',
    restartOnCrash: true,
    maxRestarts: 8,
    restartBackoff: {
        initialMs: 500,   // first restart after 500 ms
        maxMs: 30000,     // cap at 30 s
        factor: 2,        // 500 → 1000 → 2000 → 4000 → ...
    },
    restartCooldown: 120000, // treat as stable after 2 min uptime; reset counter
});
```
