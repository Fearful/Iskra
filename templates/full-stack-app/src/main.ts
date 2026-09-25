import { App } from '@iskra-bun/core';
import { WebDriver } from '@iskra-bun/web-kit';
import { ProcessManager } from '@iskra-bun/process-kit';
import { SocketDriver } from '@iskra-bun/socket-kit';
import { KVManager } from '@iskra-bun/kv-kit';
import { DbDriver } from '@iskra-bun/db-kit';
import { OracleDriver } from '@iskra-bun/db-oracle';
import { createHttpRoutes } from './interfaces/http/router';
import { createSocketRouter } from './interfaces/socket/events';
import { appConfig } from './app.config';

// 1. Initialize App
const app = new App({
    name: 'FullStackApp',
    processes: appConfig.processes,
    kv: { driver: 'memory' },
    socket: { enabled: true, port: appConfig.socketPort },
    db: { driver: 'sqlite', url: appConfig.databaseUrl },
});

// 2. Create Drivers
const kv = new KVManager();
const db = new DbDriver();
const oracle = new OracleDriver(); // Will skip if no env vars

const httpRoutes = createHttpRoutes(kv, db);
const socketRouter = createSocketRouter(kv);

// 3. Register Drivers
app.register(
    new WebDriver({
        port: appConfig.port,
        openApi: {
            path: '/doc',
            title: 'Full Stack App API',
            version: '1.0.0',
        },
        routes: httpRoutes,
    }),
);

app.register(new ProcessManager());
app.register(kv);
app.register(db);
app.register(oracle);
app.register(new SocketDriver({ port: appConfig.socketPort, router: socketRouter }));

// 4. Event Listeners
app.on('process:message', (ctx) => {
    const { message } = ctx.payload;
    // The worker prints JSON: check its shape before use.
    if (typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'worker:ping') {
        ctx.app.context.set('worker_last_ping', message);
    }
});

app.on('process:log', (ctx) => {
    ctx.logger.debug({ source: ctx.payload.name }, ctx.payload.text);
});

// 5. Start
app.start().catch((err) => {
    console.error(err);
    process.exit(1);
});
