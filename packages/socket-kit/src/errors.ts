import { IskraError, ErrorCodes } from '@iskra-bun/core';

// ─── Socket Connection Error ─────────────────────────────────────────────────

export class SocketConnectionError extends IskraError {
    constructor(message: string, options?: { cause?: Error; context?: Record<string, unknown> }) {
        super(message, { code: ErrorCodes.SOCKET_CONNECTION_ERROR, ...options });
        this.name = 'SocketConnectionError';
    }
}

// ─── Socket Message Error ────────────────────────────────────────────────────

export class SocketMessageError extends IskraError {
    constructor(message: string, options?: { cause?: Error; context?: Record<string, unknown> }) {
        super(message, { code: ErrorCodes.SOCKET_MESSAGE_ERROR, ...options });
        this.name = 'SocketMessageError';
    }
}
