/**
 * Cliente de ejemplo usando el WebSocket nativo (mismo protocolo que el SocketDriver).
 *
 * Protocolo: cada mensaje es JSON `{ event, payload }`. Las respuestas directas
 * llegan como `{ event: "<event>:reply", payload }`; las difusiones de sala
 * llegan como `{ event: "room:<sala>", payload: { type: "message" | "presence", ... } }`.
 *
 * El cliente no conoce CHAT_AUTH_SECRET: se autentica con un token que emite
 * el servidor (`bun run token <usuario>`).
 *
 * Uso:
 *   CHAT_TOKEN=$(bun run --silent token ana) bun run client          # sala "general"
 *   CHAT_TOKEN=$(bun run --silent token ana) bun run client random   # sala "random"
 */

import { forTerminal } from './terminal';

const TOKEN = process.env.CHAT_TOKEN;
const PORT = Number(process.env.SOCKET_PORT ?? 3001);
const room = process.argv[2] ?? 'general';

if (!TOKEN) {
    console.error('Falta CHAT_TOKEN. Pedile uno al servidor: CHAT_TOKEN=$(bun run --silent token <usuario>)');
    process.exit(1);
}

const ws = new WebSocket(`ws://localhost:${PORT}`);
let username = '';

const send = (event: string, payload: Record<string, unknown> = {}) => ws.send(JSON.stringify({ event, payload }));

ws.addEventListener('open', () => {
    console.log('Conectado. Autenticando...');
    // 1. Handshake: autenticar antes de cualquier otra cosa.
    send('auth', { token: TOKEN });
});

ws.addEventListener('message', (ev) => {
    const { event, payload } = JSON.parse(ev.data.toString());

    // Todo lo que viene de otros usuarios pasa por forTerminal() antes de imprimirse.
    if (typeof event === 'string' && event.startsWith('room:')) {
        const where = forTerminal(payload.room);
        if (payload.type === 'message') {
            console.log(`[#${where}] ${forTerminal(payload.username)}: ${forTerminal(payload.text)}`);
        } else if (payload.type === 'presence') {
            if (payload.joined) console.log(`→ ${forTerminal(payload.joined)} entró a #${where}`);
            if (payload.left) console.log(`← ${forTerminal(payload.left)} salió de #${where}`);
        }
        return;
    }

    switch (event) {
        case 'auth:reply':
            if (!payload.ok) {
                console.error('Auth rechazada:', forTerminal(payload.error));
                ws.close();
                return;
            }
            username = forTerminal(payload.username);
            console.log(`Autenticado como ${username}. Entrando a la sala ${forTerminal(room)}`);
            send('join', { room });
            break;

        case 'join:reply':
            if (!payload.ok) {
                console.error('No se pudo entrar a la sala:', forTerminal(payload.message ?? payload.error));
                ws.close();
                return;
            }
            console.log(`En #${forTerminal(payload.room)}. Presentes: ${payload.members.map(forTerminal).join(', ')}`);
            console.log(`Historial (${payload.history.length} mensajes, hasMore=${payload.hasMore})`);
            // Mandar un mensaje cada 3 segundos.
            setInterval(
                () => send('message', { text: `Hola desde ${username} (${new Date().toLocaleTimeString()})` }),
                3000,
            );
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
