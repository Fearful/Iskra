import { App } from '@iskra-bun/core';
import { SocketDriver } from '@iskra-bun/socket-kit';
import { KVManager } from '@iskra-bun/kv-kit';
import { createSocketRouter } from './events';

// Secreto compartido para validar el handshake. En produccion definí CHAT_AUTH_SECRET.
const AUTH_SECRET = process.env.CHAT_AUTH_SECRET ?? 'dev-secret';
const PORT = Number(process.env.SOCKET_PORT ?? 3001);

if (AUTH_SECRET === 'dev-secret') {
    console.warn('[chat-app] Usando CHAT_AUTH_SECRET por defecto ("dev-secret"). Definí uno propio para producción.');
}

const app = new App({
    name: 'ChatApp',
    socket: { enabled: true, port: PORT },
    kv: { driver: (process.env.KV_DRIVER as 'memory' | 'redis') ?? 'memory' },
});

const kv = new KVManager();
const socketRouter = createSocketRouter(kv, AUTH_SECRET);

app.register(kv);
app.register(new SocketDriver({ port: PORT, router: socketRouter }));

app.start()
    .then(() => app.logger.info({ port: PORT }, 'ChatApp escuchando'))
    .catch((err) => {
        console.error('No se pudo arrancar ChatApp:', err);
        process.exit(1);
    });
