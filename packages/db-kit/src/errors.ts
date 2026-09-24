import { IskraError, ErrorCodes } from '@iskra-bun/core';

// ─── Connection Error ────────────────────────────────────────────────────────

export class ConnectionError extends IskraError {
    constructor(message: string, options?: { cause?: Error; context?: Record<string, unknown> }) {
        super(message, { code: ErrorCodes.CONNECTION_ERROR, ...options });
        this.name = 'ConnectionError';
    }
}

// ─── Query Error ─────────────────────────────────────────────────────────────

export class QueryError extends IskraError {
    constructor(message: string, options?: { cause?: Error; context?: Record<string, unknown> }) {
        super(message, { code: ErrorCodes.QUERY_ERROR, ...options });
        this.name = 'QueryError';
    }
}

// ─── Migration Error ─────────────────────────────────────────────────────────

export class MigrationError extends IskraError {
    constructor(message: string, options?: { cause?: Error; context?: Record<string, unknown> }) {
        super(message, { code: ErrorCodes.MIGRATION_ERROR, ...options });
        this.name = 'MigrationError';
    }
}
