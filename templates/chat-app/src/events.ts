/**
 * Router de eventos del chat.
 *
 * Eventos soportados (cada uno responde con `<event>:reply`):
 *   auth     { token }                    → autentica el socket
 *   join     { room }                     → entra a una sala, marca presencia
 *   message  { text }                     → publica un mensaje en la sala actual
 *   history  { before?, limit? }          → pagina el historial de la sala
 *   rooms    {}                           → lista las salas conocidas
 *   leave    {}                           → sale de la sala actual
 *
 * Difusion a la sala via el topic de Bun (`ws.publish`), de modo que solo los
 * sockets suscriptos a esa sala reciben el evento.
 */

import { SocketRouter, type SocketContext, type SocketData } from '@iskra-bun/socket-kit';
import type { KVManager } from '@iskra-bun/kv-kit';
import type { ServerWebSocket } from 'bun';
import { verifyToken, type Session } from './auth';
import { addMember, removeMember, listMembers, listRooms, appendMessage, getMessages } from './rooms';

// Sesion asociada a cada socket autenticado.
const sessions = new WeakMap<ServerWebSocket<SocketData>, Session>();

const roomTopic = (room: string) => `room:${room}`;

const envelope = (event: string, payload: unknown) => JSON.stringify({ event, payload });

export function getSession(ws: ServerWebSocket<SocketData>): Session | undefined {
    return sessions.get(ws);
}

/** Limpia presencia cuando un socket se desconecta. Llamado desde main.ts. */
export async function handleDisconnect(kv: KVManager, ws: ServerWebSocket<SocketData>): Promise<void> {
    const session = sessions.get(ws);
    if (session?.room) {
        const members = await removeMember(kv, session.room, session.username);
        ws.publish(
            roomTopic(session.room),
            envelope('presence', { room: session.room, members, left: session.username }),
        );
    }
    sessions.delete(ws);
}

export function createSocketRouter(kv: KVManager, secret: string): SocketRouter {
    const router = new SocketRouter();

    const requireSession = (ctx: SocketContext): Session | null => {
        const session = sessions.get(ctx.socket);
        if (!session) {
            ctx.reply({ ok: false, error: 'unauthenticated', message: 'Enviá `auth` con un token válido primero.' });
            return null;
        }
        return session;
    };

    router.on<{ token?: unknown }>('auth', async (ctx) => {
        const identity = verifyToken(ctx.payload?.token, secret);
        if (!identity) {
            ctx.logger.warn('Handshake rechazado: token inválido');
            ctx.reply({ ok: false, error: 'invalid_token' });
            return;
        }

        sessions.set(ctx.socket, { ...identity, room: null });
        ctx.logger.info({ user: identity.username }, 'Socket autenticado');
        ctx.reply({ ok: true, userId: identity.userId, username: identity.username });
    });

    router.on('rooms', async (ctx) => {
        if (!requireSession(ctx)) return;
        ctx.reply({ ok: true, rooms: await listRooms(kv) });
    });

    router.on<{ room?: unknown }>('join', async (ctx) => {
        const session = requireSession(ctx);
        if (!session) return;

        const room = String(ctx.payload?.room ?? 'general').trim() || 'general';

        // Salir de la sala anterior si corresponde.
        if (session.room && session.room !== room) {
            ctx.socket.unsubscribe(roomTopic(session.room));
            const prev = await removeMember(kv, session.room, session.username);
            ctx.socket.publish(
                roomTopic(session.room),
                envelope('presence', { room: session.room, members: prev, left: session.username }),
            );
        }

        ctx.socket.subscribe(roomTopic(room));
        sessions.set(ctx.socket, { ...session, room });
        const members = await addMember(kv, room, session.username);

        // Avisar a la sala que entró alguien.
        ctx.socket.publish(roomTopic(room), envelope('presence', { room, members, joined: session.username }));

        // Mandar al recién llegado el estado inicial: presencia + ultima pagina de historial.
        const history = await getMessages(kv, room, { limit: 20 });
        ctx.reply({
            ok: true,
            room,
            members,
            history: history.items,
            hasMore: history.hasMore,
            nextBefore: history.nextBefore,
        });
    });

    router.on<{ text?: unknown }>('message', async (ctx) => {
        const session = requireSession(ctx);
        if (!session) return;

        if (!session.room) {
            ctx.reply({ ok: false, error: 'no_room', message: 'Entrá a una sala con `join` primero.' });
            return;
        }

        const text = String(ctx.payload?.text ?? '').trim();
        if (!text) {
            ctx.reply({ ok: false, error: 'empty_message' });
            return;
        }

        const msg = await appendMessage(kv, session.room, { username: session.username, text });
        ctx.logger.info({ room: session.room, user: session.username }, 'message');

        // Difundir a la sala (a los otros suscriptos) y tambien al propio emisor.
        const frame = envelope('message', { room: session.room, ...msg });
        ctx.socket.publish(roomTopic(session.room), frame);
        ctx.socket.send(frame);

        ctx.reply({ ok: true, id: msg.id });
    });

    router.on<{ before?: unknown; limit?: unknown }>('history', async (ctx) => {
        const session = requireSession(ctx);
        if (!session) return;
        if (!session.room) {
            ctx.reply({ ok: false, error: 'no_room' });
            return;
        }

        const page = await getMessages(kv, session.room, {
            before: typeof ctx.payload?.before === 'number' ? ctx.payload.before : undefined,
            limit: typeof ctx.payload?.limit === 'number' ? ctx.payload.limit : undefined,
        });
        ctx.reply({ ok: true, room: session.room, ...page });
    });

    router.on('leave', async (ctx) => {
        const session = requireSession(ctx);
        if (!session) return;
        if (!session.room) {
            ctx.reply({ ok: true, room: null });
            return;
        }

        const room = session.room;
        ctx.socket.unsubscribe(roomTopic(room));
        const members = await removeMember(kv, room, session.username);
        sessions.set(ctx.socket, { ...session, room: null });

        ctx.socket.publish(roomTopic(room), envelope('presence', { room, members, left: session.username }));
        ctx.reply({ ok: true, room: null });
    });

    return router;
}

export { listMembers };
