/**
 * Router de eventos del chat.
 *
 * Eventos soportados (cada uno responde con `<event>:reply`):
 *   auth     { token }                    → autentica el socket (token firmado, ver auth.ts)
 *   rooms    { offset?, limit? }          → lista (paginada) las salas a las que se puede entrar
 *   join     { room }                     → entra a una sala, marca presencia
 *   message  { text }                     → publica un mensaje en la sala actual
 *   history  { before?, limit? }          → pagina el historial de la sala
 *   leave    {}                           → sale de la sala actual
 *
 * Entrar y difundir pasan por `ctx.join` / `ctx.broadcast`, asi que los
 * gobiernan los hooks `canJoin` / `canPublish` que main.ts le da al
 * SocketDriver (antes `ctx.socket.subscribe` / `publish` se los salteaban).
 * Las difusiones llegan con el sobre del driver:
 * `{ event: "room:<sala>", payload: { type: "message" | "presence", ... } }`.
 */

import { SocketRouter, type CanJoin, type CanPublish, type SocketContext } from '@iskra-bun/socket-kit';
import type { KVManager } from '@iskra-bun/kv-kit';
import { verifyToken, type Session } from './auth';
import {
    addMember,
    appendMessage,
    ensureRoom,
    getMessages,
    isValidRoomName,
    listMembers,
    listRooms,
    removeMember,
    MAX_ROOMS,
} from './rooms';

/** Largo maximo de un mensaje, en bytes UTF-8. */
export const MAX_MESSAGE_BYTES = 2 * 1024;
/** Tokens invalidos que se toleran por conexion antes de cerrarla. */
export const MAX_AUTH_FAILURES = 5;
/** Tiempo que tiene una conexion para autenticarse (ver handleConnect), en ms. */
export const DEFAULT_AUTH_TIMEOUT_MS = 10_000;
const DEFAULT_ROOMS_PAGE = 50;
const MAX_ROOMS_PAGE = 100;

const ROOM_PREFIX = 'room:';
export const roomTopic = (room: string) => `${ROOM_PREFIX}${room}`;

/** La sala de un topic `room:<sala>`, o null (p. ej. `global`). */
const roomOf = (topic: string) => (topic.startsWith(ROOM_PREFIX) ? topic.slice(ROOM_PREFIX.length) : null);

/**
 * Regla de membresia del template: las salas son publicas para cualquier
 * usuario autenticado, siempre que el nombre sea valido. Una app con salas
 * privadas la reemplaza (p. ej. consultando los miembros permitidos).
 */
function mayJoin(session: Session | undefined, room: unknown): room is string {
    return session !== undefined && isValidRoomName(room);
}

/** Entero de un payload dentro de [min, max], o `fallback`. */
function intIn(value: unknown, min: number, max: number, fallback: number): number {
    return typeof value === 'number' && Number.isInteger(value) ? Math.min(Math.max(value, min), max) : fallback;
}

export interface ChatOptions {
    /** Secreto con el que se verifican los tokens (CHAT_AUTH_SECRET). */
    secret: string;
    /** Salas que se pueden crear en total. */
    maxRooms?: number;
    /** Ms que tiene una conexion para mandar un `auth` valido. Default 10000. */
    authTimeoutMs?: number;
}

/** Cierra una conexion: `SocketDriver#close`. */
export type CloseConnection = (connectionId: string, code: number, reason: string) => void;

/** Publica en un topic desde el servidor, con el mismo sobre que `ctx.broadcast`. */
export type Publish = (topic: string, payload: unknown) => void;

export interface Chat {
    router: SocketRouter;
    /** Para `SocketDriver({ canJoin })`: solo sockets autenticados, a salas que la regla permite. */
    canJoin: CanJoin;
    /** Para `SocketDriver({ canPublish })`: solo a la sala en la que esta el socket. */
    canPublish: CanPublish;
    /**
     * Llamalo con el evento `socket:connected`: cierra la conexion (1008) si no
     * se autentica en `authTimeoutMs`. Un socket que nunca manda `auth` quedaba
     * abierto mientras su cliente contestara los pings, ocupando una conexion.
     */
    handleConnect(connectionId: string, close: CloseConnection): void;
    /** Llamalo con el evento `socket:disconnected`: libera la sesion y avisa a la sala. */
    handleDisconnect(connectionId: string, publish: Publish): Promise<void>;
}

export function createChat(kv: KVManager, options: ChatOptions): Chat {
    const { secret, maxRooms = MAX_ROOMS, authTimeoutMs = DEFAULT_AUTH_TIMEOUT_MS } = options;
    // Por connectionId: se borran en handleDisconnect.
    const sessions = new Map<string, Session>();
    const authFailures = new Map<string, number>();
    const authTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const stopAuthTimer = (connectionId: string) => {
        clearTimeout(authTimers.get(connectionId));
        authTimers.delete(connectionId);
    };

    const sessionOf = (connectionId: string) => sessions.get(connectionId);
    const setRoom = (connectionId: string, room: string | null) => {
        const current = sessions.get(connectionId);
        if (current) sessions.set(connectionId, { ...current, room });
    };

    const requireSession = (ctx: SocketContext): Session | null => {
        const session = sessionOf(ctx.socket.data.connectionId);
        if (!session) {
            ctx.reply({ ok: false, error: 'unauthenticated', message: 'Enviá `auth` con un token válido primero.' });
            return null;
        }
        return session;
    };

    /** Sale de `room`: presencia actualizada a la sala (todavia como miembro) y desuscripcion. */
    const leaveRoom = async (ctx: SocketContext, room: string, username: string) => {
        const members = await removeMember(kv, room, username);
        ctx.broadcast(roomTopic(room), { type: 'presence', room, members, left: username });
        ctx.leave(roomTopic(room));
        setRoom(ctx.socket.data.connectionId, null);
    };

    const router = new SocketRouter();

    router.on<{ token?: unknown }>('auth', async (ctx) => {
        const connectionId = ctx.socket.data.connectionId;
        if (sessions.has(connectionId)) {
            // Cambiar de identidad a mitad de conexion dejaba la presencia de la anterior.
            ctx.reply({ ok: false, error: 'already_authenticated' });
            return;
        }

        const identity = verifyToken(ctx.payload?.token, secret);
        if (!identity) {
            const failures = (authFailures.get(connectionId) ?? 0) + 1;
            authFailures.set(connectionId, failures);
            ctx.logger.warn({ failures }, 'Handshake rechazado: token inválido');
            ctx.reply({ ok: false, error: 'invalid_token' });
            if (failures >= MAX_AUTH_FAILURES) {
                // Seguir probando obliga a reconectar (1008: policy violation).
                ctx.socket.close(1008, 'Too many failed auth attempts');
            }
            return;
        }

        authFailures.delete(connectionId);
        stopAuthTimer(connectionId);
        sessions.set(connectionId, { ...identity, room: null });
        ctx.logger.info({ user: identity.username }, 'Socket autenticado');
        ctx.reply({ ok: true, userId: identity.userId, username: identity.username });
    });

    router.on<{ offset?: unknown; limit?: unknown }>('rooms', async (ctx) => {
        const session = requireSession(ctx);
        if (!session) return;

        // Solo las salas a las que este usuario puede entrar, de a una pagina.
        const rooms = (await listRooms(kv)).filter((room) => mayJoin(session, room));
        const limit = intIn(ctx.payload?.limit, 1, MAX_ROOMS_PAGE, DEFAULT_ROOMS_PAGE);
        const offset = intIn(ctx.payload?.offset, 0, rooms.length, 0);
        const page = rooms.slice(offset, offset + limit);
        const next = offset + page.length;
        ctx.reply({ ok: true, rooms: page, total: rooms.length, nextOffset: next < rooms.length ? next : null });
    });

    router.on<{ room?: unknown }>('join', async (ctx) => {
        const session = requireSession(ctx);
        if (!session) return;
        const connectionId = ctx.socket.data.connectionId;

        const room = ctx.payload?.room ?? 'general';
        if (!isValidRoomName(room)) {
            ctx.reply({
                ok: false,
                error: 'invalid_room',
                message: 'Nombre de sala: 1-64 caracteres a-z, 0-9, "_" o "-".',
            });
            return;
        }
        const topic = roomTopic(room);
        const previous = session.room;

        if (previous !== room) {
            // canJoin decide: si lo niega, el socket no queda suscripto.
            ctx.join(topic);
            if (!ctx.socket.isSubscribed(topic)) {
                ctx.reply({ ok: false, error: 'forbidden', room });
                return;
            }
            if (!(await ensureRoom(kv, room, maxRooms))) {
                ctx.leave(topic);
                ctx.reply({ ok: false, error: 'room_limit', message: 'No se pueden crear más salas.' });
                return;
            }
            if (previous) await leaveRoom(ctx, previous, session.username);
            setRoom(connectionId, room);
        }

        const members = await addMember(kv, room, session.username);
        // Avisar a la sala que entró alguien (el propio socket incluido).
        ctx.broadcast(topic, { type: 'presence', room, members, joined: session.username });

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
        const room = session.room;
        if (!room) {
            ctx.reply({ ok: false, error: 'no_room', message: 'Entrá a una sala con `join` primero.' });
            return;
        }

        const text = typeof ctx.payload?.text === 'string' ? ctx.payload.text.trim() : '';
        if (!text) {
            ctx.reply({ ok: false, error: 'empty_message' });
            return;
        }
        if (Buffer.byteLength(text, 'utf8') > MAX_MESSAGE_BYTES) {
            ctx.reply({ ok: false, error: 'message_too_long', maxBytes: MAX_MESSAGE_BYTES });
            return;
        }

        const msg = await appendMessage(kv, room, { username: session.username, text });
        ctx.logger.info({ room, user: session.username }, 'message');

        // Llega a toda la sala, el emisor incluido.
        ctx.broadcast(roomTopic(room), { type: 'message', room, ...msg });
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
        if (session.room) await leaveRoom(ctx, session.room, session.username);
        ctx.reply({ ok: true, room: null });
    });

    return {
        router,
        canJoin: (connection, topic) => mayJoin(sessionOf(connection.data.connectionId), roomOf(topic)),
        canPublish: (connection, topic) => {
            const session = sessionOf(connection.data.connectionId);
            return !!session?.room && topic === roomTopic(session.room) && connection.isSubscribed(topic);
        },
        handleConnect(connectionId, close) {
            const timer = setTimeout(() => {
                authTimers.delete(connectionId);
                if (!sessions.has(connectionId)) close(connectionId, 1008, 'Authentication timeout');
            }, authTimeoutMs);
            // Un timer pendiente no mantiene vivo el proceso.
            timer.unref?.();
            authTimers.set(connectionId, timer);
        },
        async handleDisconnect(connectionId, publish) {
            authFailures.delete(connectionId);
            stopAuthTimer(connectionId);
            const session = sessions.get(connectionId);
            sessions.delete(connectionId);
            if (!session?.room) return;
            // Sin esto el usuario quedaba listado en la sala para siempre.
            const members = await removeMember(kv, session.room, session.username);
            publish(roomTopic(session.room), { type: 'presence', room: session.room, members, left: session.username });
        },
    };
}

export { listMembers };
