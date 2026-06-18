/**
 * Gestion de salas, presencia e historial de mensajes respaldada por @iskra-bun/kv-kit.
 *
 * Claves usadas en el KV store:
 *   room:<room>:messages  → ChatMessage[]   (historial, mas reciente al final)
 *   room:<room>:members   → string[]        (usernames presentes en la sala)
 *   rooms:index           → string[]        (todas las salas conocidas)
 */

import type { KVManager } from '@iskra-bun/kv-kit';

export interface ChatMessage {
    id: string;
    username: string;
    text: string;
    time: number;
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

/** Crea (si hace falta) la sala y la registra en el indice global. */
export async function ensureRoom(kv: KVManager, room: string): Promise<void> {
    const index: string[] = (await kv.get(ROOMS_INDEX)) ?? [];
    if (!index.includes(room)) {
        await kv.set(ROOMS_INDEX, unique([...index, room]));
    }
}

export async function listRooms(kv: KVManager): Promise<string[]> {
    return (await kv.get(ROOMS_INDEX)) ?? [];
}

/** Agrega un usuario a la presencia de la sala. Devuelve la lista actualizada. */
export async function addMember(kv: KVManager, room: string, username: string): Promise<string[]> {
    await ensureRoom(kv, room);
    const members: string[] = (await kv.get(membersKey(room))) ?? [];
    const next = unique([...members, username]);
    await kv.set(membersKey(room), next);
    return next;
}

/** Quita un usuario de la presencia de la sala. Devuelve la lista actualizada. */
export async function removeMember(kv: KVManager, room: string, username: string): Promise<string[]> {
    const members: string[] = (await kv.get(membersKey(room))) ?? [];
    const next = members.filter((m) => m !== username);
    await kv.set(membersKey(room), next);
    return next;
}

export async function listMembers(kv: KVManager, room: string): Promise<string[]> {
    return (await kv.get(membersKey(room))) ?? [];
}

/** Persiste un mensaje en la sala, recortando el historial a MAX_HISTORY. */
export async function appendMessage(
    kv: KVManager,
    room: string,
    msg: Omit<ChatMessage, 'id' | 'time'>,
): Promise<ChatMessage> {
    await ensureRoom(kv, room);
    const history: ChatMessage[] = (await kv.get(messagesKey(room))) ?? [];

    const full: ChatMessage = {
        ...msg,
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        time: Date.now(),
    };

    const next = [...history, full].slice(-MAX_HISTORY);
    await kv.set(messagesKey(room), next);
    return full;
}

/**
 * Paginacion del historial por cursor temporal (estilo "scroll hacia arriba").
 * Devuelve hasta `limit` mensajes con `time < before`, del mas viejo al mas nuevo.
 * Pasa `nextBefore` como `before` en la siguiente llamada para seguir paginando.
 */
export async function getMessages(
    kv: KVManager,
    room: string,
    opts: { before?: number; limit?: number } = {},
): Promise<Page<ChatMessage>> {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const before = opts.before ?? Number.POSITIVE_INFINITY;

    const history: ChatMessage[] = (await kv.get(messagesKey(room))) ?? [];
    const older = history.filter((m) => m.time < before);

    // Tomamos los `limit` mas recientes dentro del rango y los devolvemos en orden cronologico.
    const slice = older.slice(-limit);

    return {
        items: slice,
        total: history.length,
        hasMore: older.length > slice.length,
        nextBefore: slice.length > 0 ? slice[0].time : null,
    };
}
