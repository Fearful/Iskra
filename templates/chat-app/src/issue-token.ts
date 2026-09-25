/**
 * Emite un token de chat firmado. Corre del lado del servidor, con el mismo
 * CHAT_AUTH_SECRET que el servidor: los clientes reciben solo el token.
 *
 * Uso:
 *   bun run token ana            # vence en 1 hora
 *   bun run token ana 86400      # vence en 24 horas
 *
 * En una app real el token lo emite tu servicio de login con `issueToken()`
 * despues de autenticar al usuario.
 */

import { issueToken, resolveAuthSecret } from './auth';

const [username, ttl] = process.argv.slice(2);

if (!username) {
    console.error('Uso: bun run token <usuario> [segundos]');
    process.exit(1);
}

try {
    const { secret, warning } = resolveAuthSecret(process.env.CHAT_AUTH_SECRET, process.env.NODE_ENV === 'production');
    if (warning) console.error(`[chat-app] ${warning}`);
    // El token va solo a stdout: `CHAT_TOKEN=$(bun run --silent token ana)`.
    console.log(issueToken(username, secret, { ttlSeconds: ttl === undefined ? undefined : Number(ttl) }));
} catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
}
