import { App } from '@iskra-bun/core';
import { SocketDriver } from '@iskra-bun/socket-kit';
import { KVManager } from '@iskra-bun/kv-kit';
import { resolveAuthSecret } from './auth';
import { createChat } from './events';

// Secreto con el que el servidor firma y verifica los tokens (ver auth.ts). En
// produccion es obligatorio: sin uno propio de 32+ caracteres no arranca.
let secret: string;
try {
    const resolved = resolveAuthSecret(process.env.CHAT_AUTH_SECRET, process.env.NODE_ENV === 'production');
    secret = resolved.secret;
    if (resolved.warning) console.warn(`[chat-app] ${resolved.warning}`);
} catch (err) {
    console.error(`[chat-app] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
}

const PORT = Number(process.env.SOCKET_PORT ?? 3001);

const app = new App({
    name: 'ChatApp',
    socket: { enabled: true, port: PORT },
    kv: { driver: (process.env.KV_DRIVER as 'memory' | 'redis') ?? 'memory' },
});

const kv = new KVManager();
const chat = createChat(kv, { secret });

// canJoin / canPublish gobiernan ctx.join / ctx.broadcast: solo sockets
// autenticados entran a salas (publicas, con nombre valido) y cada uno publica
// solo en la sala en la que esta.
const socketDriver = new SocketDriver({
    port: PORT,
    router: chat.router,
    canJoin: chat.canJoin,
    canPublish: chat.canPublish,
});

app.register(kv);
app.register(socketDriver);

// Presencia al cortarse la conexion (cerrar la pestaña, perder la red).
app.on('socket:disconnected', (ctx) =>
    chat.handleDisconnect(ctx.payload.connectionId, (topic, payload) =>
        socketDriver.broadcastTo(topic, topic, payload),
    ),
);

app.start()
    .then(() => app.logger.info({ port: PORT }, 'ChatApp escuchando'))
    .catch((err) => {
        console.error('No se pudo arrancar ChatApp:', err);
        process.exit(1);
    });
