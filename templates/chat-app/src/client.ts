/**
 * Cliente de ejemplo usando el WebSocket nativo (mismo protocolo que el SocketDriver).
 *
 * Protocolo: cada mensaje es JSON `{ event, payload }`. Las respuestas directas
 * llegan como `{ event: "<event>:reply", payload }`; las difusiones de sala llegan
 * como `message` / `presence`.
 *
 * Uso:
 *   bun run src/client.ts                 # username aleatorio, sala "general"
 *   bun run src/client.ts Ana general     # username Ana en sala general
 */

import { buildToken } from './auth';

const SECRET = process.env.CHAT_AUTH_SECRET ?? 'dev-secret';
const PORT = Number(process.env.SOCKET_PORT ?? 3001);

const username = process.argv[2] ?? `User_${Math.floor(Math.random() * 1000)}`;
const room = process.argv[3] ?? 'general';

const ws = new WebSocket(`ws://localhost:${PORT}`);

const send = (event: string, payload: Record<string, unknown> = {}) => ws.send(JSON.stringify({ event, payload }));

ws.addEventListener('open', () => {
    console.log(`Conectado como ${username}. Autenticando...`);
    // 1. Handshake: autenticar antes de cualquier otra cosa.
    send('auth', { token: buildToken(username, SECRET) });
});

ws.addEventListener('message', (ev) => {
    const { event, payload } = JSON.parse(ev.data.toString());

    switch (event) {
        case 'auth:reply':
            if (!payload.ok) {
                console.error('Auth rechazada:', payload.error);
                ws.close();
                return;
            }
            console.log('Autenticado. Entrando a la sala', room);
            send('join', { room });
            break;

        case 'join:reply':
            console.log(`En #${payload.room}. Presentes: ${payload.members.join(', ')}`);
            console.log(`Historial (${payload.history.length} mensajes, hasMore=${payload.hasMore})`);
            // Mandar un mensaje cada 3 segundos.
            setInterval(() => send('message', { text: `Hola desde ${username} (${new Date().toLocaleTimeString()})` }), 3000);
            break;

        case 'presence':
            if (payload.joined) console.log(`→ ${payload.joined} entró a #${payload.room}`);
            if (payload.left) console.log(`← ${payload.left} salió de #${payload.room}`);
            break;

        case 'message':
            console.log(`[#${payload.room}] ${payload.username}: ${payload.text}`);
            break;

        case 'history:reply':
            console.log(`Página de historial: ${payload.items.length} mensajes (nextBefore=${payload.nextBefore})`);
            break;
    }
});

ws.addEventListener('close', () => console.log('Desconectado'));
ws.addEventListener('error', (err) => console.error('Error de socket:', err));

// Salida limpia: avisar `leave` antes de cerrar.
process.on('SIGINT', () => {
    send('leave');
    setTimeout(() => ws.close(), 100);
    setTimeout(() => process.exit(0), 300);
});
