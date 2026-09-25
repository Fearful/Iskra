/**
 * Autenticacion por API key con el ApiKeyFeature de web-kit.
 *
 * Cada clave identifica a un usuario y le da un rol, y se configuran con
 * `API_KEYS="<userId>:<rol>:<clave>,<userId>:<rol>:<clave>"`:
 *   - `admin`: crea productos, crea ordenes y ve las de todos.
 *   - `customer`: crea ordenes a su nombre y ve solo las suyas.
 * El cliente manda la clave en `X-API-Key` o `Authorization: Bearer <clave>`.
 * Sin claves configuradas el catalogo sigue siendo publico y todo lo demas
 * responde 401.
 *
 * Para logins de usuarios finales reemplazalo por el AuthFeature (Better
 * Auth): el userId sale entonces de `c.get('user').id`.
 */

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ApiKeyFeature } from '@iskra-bun/web-kit';

export const ROLE_SCOPES = {
    admin: ['products:write', 'orders:write', 'orders:read:all'],
    customer: ['orders:write'],
} as const;

export type Role = keyof typeof ROLE_SCOPES;

export interface ApiKeyEntry {
    userId: string;
    role: Role;
    key: string;
}

/** Claves cortas se adivinan: generalas con `openssl rand -hex 32`. */
export const MIN_KEY_LENGTH = 32;
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;

const isRole = (role: string): role is Role => Object.hasOwn(ROLE_SCOPES, role);

/** Lee API_KEYS. Falla al arrancar ante una entrada invalida (el mensaje nunca incluye la clave). */
export function parseApiKeys(value: string | undefined): ApiKeyEntry[] {
    if (!value?.trim()) return [];
    const seen = new Set<string>();
    return value.split(',').map((raw, i) => {
        const parts = raw.trim().split(':');
        const where = `API_KEYS, entrada ${i + 1}`;
        if (parts.length !== 3) throw new Error(`${where}: el formato es <userId>:<rol>:<clave>`);
        const [userId, role, key] = parts;
        if (!USER_ID.test(userId)) throw new Error(`${where}: userId invalido (A-Z, a-z, 0-9, "_" o "-")`);
        // Sin repetir el valor: con los campos en otro orden, seria la clave.
        if (!isRole(role)) throw new Error(`${where}: el rol debe ser ${Object.keys(ROLE_SCOPES).join(' o ')}`);
        if (key.length < MIN_KEY_LENGTH)
            throw new Error(`${where}: la clave debe tener al menos ${MIN_KEY_LENGTH} caracteres`);
        if (seen.has(key)) throw new Error(`${where}: clave repetida`);
        seen.add(key);
        return { userId, role, key };
    });
}

export function createApiKeyFeature(entries: readonly ApiKeyEntry[]): ApiKeyFeature {
    return new ApiKeyFeature({
        staticKeys: entries.map(({ userId, role, key }) => ({
            key,
            name: userId,
            scopes: [...ROLE_SCOPES[role]],
            metadata: { userId, role },
        })),
    });
}

/** El usuario de la API key de la peticion (las rutas lo exigen con requireApiKey/requireScope). */
export function currentUserId(c: Context): string {
    const userId = c.get('apiKey')?.metadata?.userId;
    if (typeof userId !== 'string') throw new HTTPException(401, { message: 'API key is required' });
    return userId;
}
