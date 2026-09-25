/**
 * Autenticacion de editores por API key, con el ApiKeyFeature de web-kit.
 *
 * `API_KEYS="<editorId>:editor:<clave>,<editorId>:editor:<clave>"`: cada clave
 * es un editor. El sitio publico (leer contenido publicado) no necesita clave;
 * escribir, publicar y leer borradores o el historial, si. El editor manda la
 * clave en `X-API-Key` o `Authorization: Bearer <clave>`.
 *
 * Para un panel con login de usuarios, reemplazalo por el AuthFeature (Better
 * Auth) y decidi el rol de editor a partir de `c.get('user')`.
 */

import type { Context } from 'hono';
import { ApiKeyFeature } from '@iskra-bun/web-kit';

export const ROLE_SCOPES = {
    editor: ['content:write', 'content:read:drafts'],
} as const;

export type Role = keyof typeof ROLE_SCOPES;

export interface ApiKeyEntry {
    editorId: string;
    role: Role;
    key: string;
}

/** Claves cortas se adivinan: generalas con `openssl rand -hex 32`. */
export const MIN_KEY_LENGTH = 32;
const EDITOR_ID = /^[A-Za-z0-9_-]{1,64}$/;

const isRole = (role: string): role is Role => Object.hasOwn(ROLE_SCOPES, role);

/** Lee API_KEYS. Falla al arrancar ante una entrada invalida (el mensaje nunca incluye la clave). */
export function parseApiKeys(value: string | undefined): ApiKeyEntry[] {
    if (!value?.trim()) return [];
    const seen = new Set<string>();
    return value.split(',').map((raw, i) => {
        const parts = raw.trim().split(':');
        const where = `API_KEYS, entrada ${i + 1}`;
        if (parts.length !== 3) throw new Error(`${where}: el formato es <editorId>:editor:<clave>`);
        const [editorId, role, key] = parts;
        if (!EDITOR_ID.test(editorId)) throw new Error(`${where}: editorId invalido (A-Z, a-z, 0-9, "_" o "-")`);
        // Sin repetir el valor: con los campos en otro orden, seria la clave.
        if (!isRole(role)) throw new Error(`${where}: el rol debe ser ${Object.keys(ROLE_SCOPES).join(' o ')}`);
        if (key.length < MIN_KEY_LENGTH) {
            throw new Error(`${where}: la clave debe tener al menos ${MIN_KEY_LENGTH} caracteres`);
        }
        if (seen.has(key)) throw new Error(`${where}: clave repetida`);
        seen.add(key);
        return { editorId, role, key };
    });
}

export function createApiKeyFeature(entries: readonly ApiKeyEntry[]): ApiKeyFeature {
    return new ApiKeyFeature({
        staticKeys: entries.map(({ editorId, role, key }) => ({
            key,
            name: editorId,
            scopes: [...ROLE_SCOPES[role]],
            metadata: { editorId, role },
        })),
    });
}

/** Si la peticion viene de un editor (puede ver borradores e historial). */
export function canReadDrafts(c: Context): boolean {
    return c.get('hasScope')?.('content:read:drafts') ?? false;
}
