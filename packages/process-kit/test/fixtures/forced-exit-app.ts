// Child process for forced-exit.test.ts: an App whose ProcessManager runs a
// child that ignores SIGTERM, with a shutdownTimeoutMs shorter than the
// manager's SIGKILL escalation, so SIGTERM ends in a forced process.exit(1).
import { App } from '@iskra-bun/core';
import { ProcessManager } from '../../src/spawner';

const app = new App({
    name: 'ForcedExitApp',
    logger: { level: 'silent' },
    shutdownTimeoutMs: 300,
    processes: {
        stubborn: {
            command: 'sh',
            args: ['-c', 'trap "" TERM; echo pid=$$; while :; do sleep 1; done'],
            mode: 'stdio',
        },
    },
});
const pm = new ProcessManager();
app.register(pm);
app.on('process:log', ({ payload }) => {
    process.stdout.write(`child ${payload.text}\n`);
});
await app.start();
// After start(): the App's signal handlers are installed only then.
process.stdout.write('ready\n');
setInterval(() => {}, 1000); // keep the process alive like a server would
