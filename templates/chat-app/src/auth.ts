/**
 * Autenticacion del handshake WebSocket con tokens firmados.
 *
 * El SocketDriver de Iskra hace el upgrade sin pasar datos al socket, asi que
 * la autenticacion se resuelve en el primer mensaje (`auth { token }`). El
 * token lo emite el servidor (`bun run token <usuario>`, o el servicio de login
 * de tu app) firmando usuario + vencimiento con HMAC-SHA256 y CHAT_AUTH_SECRET.
 * Los clientes solo reciben su token: nunca el secreto, con el que cualquiera
 * podia armar un token a nombre de otro usuario.
 *
 * Formato: `v1.<usuario>.<vencimiento en segundos epoch>.<firma base64url>`.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface Session {
    userId: string;
    username: string;
    room: string | null;
}

export interface Identity {
    userId: string;
    username: string;
}

/** Secreto de ejemplo: solo se acepta fuera de produccion. */
export const DEV_SECRET = 'dev-secret';
export const MIN_SECRET_LENGTH = 32;
export const DEFAULT_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * Minusculas, numeros, `_` y `-`. El userId sale del nombre, asi que `Ana` y
 * `ana` eran dos usuarios distintos con el mismo userId: ahora se normaliza.
 */
const USERNAME = /^[a-z0-9_-]{1,32}$/;
const EXPIRY = /^\d{1,12}$/;
const MAX_TOKEN_LENGTH = 256;

/** El nombre en su forma canonica (minusculas), o null si no es valido. */
export function normalizeUsername(input: unknown): string | null {
    if (typeof input !== 'string') return null;
    const name = input.trim().toLowerCase();
    return USERNAME.test(name) ? name : null;
}

function signature(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Emite un token para `username` que vence en `ttlSeconds` (1 hora por defecto). */
export function issueToken(
    username: string,
    secret: string,
    options: { ttlSeconds?: number; now?: number } = {},
): string {
    const name = normalizeUsername(username);
    if (!name) throw new Error('Usuario invalido: usá de 1 a 32 caracteres a-z, 0-9, "_" o "-"');
    const ttl = options.ttlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS;
    if (!Number.isSafeInteger(ttl) || ttl <= 0) throw new Error('La duracion del token debe ser un entero positivo');

    const expiresAt = Math.floor((options.now ?? Date.now()) / 1000) + ttl;
    const payload = `v1.${name}.${expiresAt}`;
    return `${payload}.${signature(payload, secret)}`;
}

/** La identidad de un token valido y vigente, o null. */
export function verifyToken(token: unknown, secret: string, now = Date.now()): Identity | null {
    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;

    const parts = token.split('.');
    if (parts.length !== 4) return null;
    const [version, username, expiresAt, given] = parts;
    if (version !== 'v1' || !USERNAME.test(username) || !EXPIRY.test(expiresAt)) return null;

    // Comparacion en tiempo constante: `!==` corta en el primer caracter
    // distinto y deja medir cuanto de la firma se acerto.
    const expected = Buffer.from(signature(`${version}.${username}.${expiresAt}`, secret));
    const received = Buffer.from(given);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

    if (Number(expiresAt) * 1000 <= now) return null;
    return { userId: `u_${username}`, username };
}

/**
 * El secreto con el que el servidor firma y verifica los tokens. En produccion
 * no arranca si CHAT_AUTH_SECRET falta, esta vacio, es el de ejemplo o tiene
 * menos de 32 caracteres; en desarrollo usa `dev-secret` con una advertencia.
 */
export function resolveAuthSecret(
    value: string | undefined,
    production: boolean,
): { secret: string; warning?: string } {
    // `||` y no `??`: un CHAT_AUTH_SECRET vacio no es un secreto.
    const secret = value || '';
    if (secret && secret !== DEV_SECRET && secret.length >= MIN_SECRET_LENGTH) return { secret };

    const problem = !secret
        ? 'no está definido'
        : secret === DEV_SECRET
          ? 'es el de ejemplo'
          : `tiene menos de ${MIN_SECRET_LENGTH} caracteres`;
    if (production) {
        throw new Error(
            `CHAT_AUTH_SECRET ${problem}: definí uno aleatorio de al menos ${MIN_SECRET_LENGTH} caracteres ` +
                '(por ejemplo `openssl rand -base64 48`).',
        );
    }
    return { secret: secret || DEV_SECRET, warning: `CHAT_AUTH_SECRET ${problem}: sirve solo para desarrollo.` };
}
