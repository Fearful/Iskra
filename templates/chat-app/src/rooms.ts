/**
 * Gestion de salas, presencia e historial de mensajes respaldada por @iskra-bun/kv-kit.
 *
 * Claves usadas en el KV store:
 *   room:<room>:messages  → ChatMessage[]   (historial, mas reciente al final)
 *   room:<room>:members   → string[]        (usernames presentes en la sala)
 *   rooms:index           → string[]        (todas las salas conocidas)
 *
 * Cada clave se lee y reescribe entera, así que las escrituras a una misma
 * clave se serializan dentro del proceso (antes, dos mensajes simultáneos
 * leían el mismo historial y uno pisaba al otro). Con varias instancias
 * compartiendo Redis haría falta una estructura nativa (listas de Redis).
 */

import type { KVManager } from '@iskra-bun/kv-kit';

export interface ChatMessage {
    id: string;
    username: string;
    text: string;
    time: number;
    /** Posición en la sala, creciente y única: el cursor de la paginación. */
    seq: number;
}

export interface Page<T> {
    items: T[];
    total: number;
    hasMore: boolean;
    nextBefore: number | null;
}

const ROOMS_INDEX = 'rooms:index';
const MAX_HISTORY = 500;

const messagesKey = (room: string) => `room:${room}:messages`;
const membersKey = (room: string) => `room:${room}:members`;

function unique<T>(items: T[]): T[] {
    return [...new Set(items)];
}

const pending = new Map<string, Promise<unknown>>();

/** Corre `fn` después de la escritura anterior a la misma clave. */
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = pending.get(key) ?? Promise.resolve();
    const result = previous.then(fn, fn);
    const settled = result.then(() => undefined, () => undefined);
    pending.set(key, settled);
    void settled.then(() => {
        if (pending.get(key) === settled) pending.delete(key);
    });
    return result;
}

/** Crea (si hace falta) la sala y la registra en el indice global. */
export async function ensureRoom(kv: KVManager, room: string): Promise<void> {
    await withLock(ROOMS_INDEX, async () => {
        const index: string[] = (await kv.get(ROOMS_INDEX)) ?? [];
        if (!index.includes(room)) {
            await kv.set(ROOMS_INDEX, unique([...index, room]));
        }
    });
}

export async function listRooms(kv: KVManager): Promise<string[]> {
    return (await kv.get(ROOMS_INDEX)) ?? [];
}

/** Agrega un usuario a la presencia de la sala. Devuelve la lista actualizada. */
export async function addMember(kv: KVManager, room: string, username: string): Promise<string[]> {
    await ensureRoom(kv, room);
    return withLock(membersKey(room), async () => {
        const members: string[] = (await kv.get(membersKey(room))) ?? [];
        const next = unique([...members, username]);
        await kv.set(membersKey(room), next);
        return next;
    });
}

/** Quita un usuario de la presencia de la sala. Devuelve la lista actualizada. */
export async function removeMember(kv: KVManager, room: string, username: string): Promise<string[]> {
    return withLock(membersKey(room), async () => {
        const members: string[] = (await kv.get(membersKey(room))) ?? [];
        const next = members.filter((m) => m !== username);
        await kv.set(membersKey(room), next);
        return next;
    });
}

export async function listMembers(kv: KVManager, room: string): Promise<string[]> {
    return (await kv.get(membersKey(room))) ?? [];
}

/** Persiste un mensaje en la sala, recortando el historial a MAX_HISTORY. */
export async function appendMessage(
    kv: KVManager,
    room: string,
    msg: Omit<ChatMessage, 'id' | 'time' | 'seq'>,
): Promise<ChatMessage> {
    await ensureRoom(kv, room);
    return withLock(messagesKey(room), async () => {
        const history: ChatMessage[] = (await kv.get(messagesKey(room))) ?? [];
        const last = history[history.length - 1];

        const full: ChatMessage = {
            ...msg,
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            time: Date.now(),
            seq: (last?.seq ?? history.length - 1) + 1,
        };

        const next = [...history, full].slice(-MAX_HISTORY);
        await kv.set(messagesKey(room), next);
        return full;
    });
}

/**
 * Paginacion del historial por cursor (estilo "scroll hacia arriba").
 * Devuelve hasta `limit` mensajes con `seq < before`, del mas viejo al mas nuevo.
 * Pasa `nextBefore` como `before` en la siguiente llamada para seguir paginando.
 * El cursor es la posición del mensaje, no su hora: con `time`, los mensajes
 * del mismo milisegundo que el primero de una página se salteaban.
 */
export async function getMessages(
    kv: KVManager,
    room: string,
    opts: { before?: number; limit?: number } = {},
): Promise<Page<ChatMessage>> {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const before = opts.before ?? Number.POSITIVE_INFINITY;

    const history: ChatMessage[] = (await kv.get(messagesKey(room))) ?? [];
    const older = history.filter((m, i) => (m.seq ?? i) < before);

    // Tomamos los `limit` mas recientes dentro del rango y los devolvemos en orden cronologico.
    const slice = older.slice(-limit);

    return {
        items: slice,
        total: history.length,
        hasMore: older.length > slice.length,
        nextBefore: slice.length > 0 ? (slice[0].seq ?? history.indexOf(slice[0])) : null,
    };
}
