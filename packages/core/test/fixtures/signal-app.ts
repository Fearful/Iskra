// Child process for lifecycle.test.ts: starts an App, prints "ready", and
// reports when its driver is stopped. STOP_HANGS makes stop() never resolve.
import { App } from '../../src/app';

const app = new App({
    name: 'SignalApp',
    logger: { level: 'silent' },
    shutdownTimeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 5000),
});
app.register({
    name: 'Probe',
    init: () => {},
    stop: () => {
        process.stdout.write('stopping\n');
        return process.env.STOP_HANGS ? new Promise<void>(() => {}) : undefined;
    },
});
await app.start();
process.stdout.write('ready\n');
setInterval(() => {}, 1000); // keep the process alive like a server would
