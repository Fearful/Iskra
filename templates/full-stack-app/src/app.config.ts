import { join } from 'path';

export const appConfig = {
    port: Number(process.env.PORT) || 3000,
    socketPort: Number(process.env.SOCKET_PORT) || 3001,
    databaseUrl: process.env.DATABASE_URL || ':memory:',
    processes: {
        'my-worker': {
            // WORKER_COMMAND runs a prebuilt worker binary (the Docker image
            // compiles one: it has no bun, and a compiled app cannot read
            // scripts/ from import.meta.dir).
            command: process.env.WORKER_COMMAND || 'bun',
            args: process.env.WORKER_COMMAND ? [] : [join(import.meta.dir, 'scripts', 'worker.js')],
            mode: 'stdio' as const,
            restartOnCrash: true
        }
    }
};
