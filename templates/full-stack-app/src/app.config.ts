import { join } from 'path';

export const appConfig = {
    port: Number(process.env.PORT) || 3000,
    socketPort: Number(process.env.SOCKET_PORT) || 3001,
    databaseUrl: process.env.DATABASE_URL || ':memory:',
    processes: {
        'my-worker': {
            command: 'bun',
            args: [join(import.meta.dir, 'scripts', 'worker.js')],
            mode: 'stdio' as const,
            restartOnCrash: true
        }
    }
};
