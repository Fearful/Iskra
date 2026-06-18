/**
 * Autenticacion del handshake WebSocket.
 *
 * El SocketDriver de Iskra hace el upgrade sin pasar datos al socket, asi que
 * la autenticacion se resuelve en el primer mensaje (`auth`). Validamos un token
 * simple y, si es valido, asociamos una sesion al socket. El resto de los
 * eventos (join/message/history) exigen una sesion autenticada.
 */

export interface Session {
    userId: string;
    username: string;
    room: string | null;
}

/**
 * Valida un token de handshake. En produccion esto verificaria un JWT firmado
 * contra `process.env.CHAT_AUTH_SECRET`. Para el template usamos un formato
 * legible: `token:<username>` y un secreto compartido por entorno.
 */
export function verifyToken(token: unknown, secret: string): { userId: string; username: string } | null {
    if (typeof token !== 'string' || token.length === 0) {
        return null;
    }

    const [prefix, username, providedSecret] = token.split(':');

    if (prefix !== 'token' || !username) {
        return null;
    }

    // El secreto compartido debe coincidir con el del servidor.
    if (providedSecret !== secret) {
        return null;
    }

    return {
        userId: `u_${username.toLowerCase()}`,
        username,
    };
}

/**
 * Ayuda para que los clientes construyan un token valido sin duplicar el formato.
 */
export function buildToken(username: string, secret: string): string {
    return `token:${username}:${secret}`;
}
