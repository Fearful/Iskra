/**
 * Quien puede publicar en el feed: API keys de autores (ApiKeyFeature de
 * web-kit) y un limite de posts por autor (RateLimitFeature).
 *
 * `API_KEYS="<authorId>:author:<clave>,<authorId>:author:<clave>"`: cada clave
 * es un autor, y el `authorId` de sus posts sale de ella (antes lo mandaba el
 * cliente en el cuerpo, asi que cualquiera publicaba a nombre de otro). Leer el
 * feed sigue siendo publico. La clave va en `X-API-Key` o
 * `Authorization: Bearer <clave>`.
 */

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ApiKeyFeature, RateLimitFeature, getClientIp } from '@iskra-bun/web-kit';

export const ROLE_SCOPES = {
    author: ['feed:post'],
} as const;

export type Role = keyof typeof ROLE_SCOPES;

export interface ApiKeyEntry {
    authorId: string;
    role: Role;
    key: string;
}

/** Claves cortas se adivinan: generalas con `openssl rand -hex 32`. */
export const MIN_KEY_LENGTH = 32;
/** Posts por autor por minuto: cada post se difunde a todos los sockets conectados. */
export const POSTS_PER_MINUTE = 10;
const AUTHOR_ID = /^[A-Za-z0-9_-]{1,64}$/;

const isRole = (role: string): role is Role => Object.hasOwn(ROLE_SCOPES, role);

/** Lee API_KEYS. Falla al arrancar ante una entrada invalida (el mensaje nunca incluye la clave). */
export function parseApiKeys(value: string | undefined): ApiKeyEntry[] {
    if (!value?.trim()) return [];
    const seen = new Set<string>();
    return value.split(',').map((raw, i) => {
        const parts = raw.trim().split(':');
        const where = `API_KEYS, entrada ${i + 1}`;
        if (parts.length !== 3) throw new Error(`${where}: el formato es <authorId>:author:<clave>`);
        const [authorId, role, key] = parts;
        if (!AUTHOR_ID.test(authorId)) throw new Error(`${where}: authorId invalido (A-Z, a-z, 0-9, "_" o "-")`);
        // Sin repetir el valor: con los campos en otro orden, seria la clave.
        if (!isRole(role)) throw new Error(`${where}: el rol debe ser ${Object.keys(ROLE_SCOPES).join(' o ')}`);
        if (key.length < MIN_KEY_LENGTH) {
            throw new Error(`${where}: la clave debe tener al menos ${MIN_KEY_LENGTH} caracteres`);
        }
        if (seen.has(key)) throw new Error(`${where}: clave repetida`);
        seen.add(key);
        return { authorId, role, key };
    });
}

/**
 * Los features de autenticacion, en este orden: el limite de posts se cuenta
 * por autor, asi que el ApiKeyFeature tiene que correr antes.
 */
export function createAuthFeatures(entries: readonly ApiKeyEntry[]): [ApiKeyFeature, RateLimitFeature] {
    const apiKeys = new ApiKeyFeature({
        staticKeys: entries.map(({ authorId, role, key }) => ({
            key,
            name: authorId,
            scopes: [...ROLE_SCOPES[role]],
            metadata: { authorId, role },
        })),
    });
    const postLimit = new RateLimitFeature({
        name: 'feed-posts',
        windowMs: 60_000,
        max: POSTS_PER_MINUTE,
        // Solo los posts; leer el feed no cuenta.
        skip: (c) => !(c.req.method === 'POST' && c.req.path === '/feed'),
        keyGenerator: (c) => {
            const authorId = c.get('apiKey')?.metadata?.authorId;
            return typeof authorId === 'string' ? `author:${authorId}` : `ip:${getClientIp(c) ?? 'unknown'}`;
        },
    });
    return [apiKeys, postLimit];
}

/** El autor de la API key de la peticion (la ruta lo exige con requireScope). */
export function currentAuthorId(c: Context): string {
    const authorId = c.get('apiKey')?.metadata?.authorId;
    if (typeof authorId !== 'string') throw new HTTPException(401, { message: 'API key is required' });
    return authorId;
}
