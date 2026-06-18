import { IskraError, ErrorCodes } from '@iskra-bun/core';

// ─── Queue Error ─────────────────────────────────────────────────────────────

export class QueueError extends IskraError {
    constructor(message: string, options?: { cause?: Error; context?: Record<string, unknown> }) {
        super(message, { code: ErrorCodes.QUEUE_ERROR, ...options });
        this.name = 'QueueError';
    }
}

// ─── Job Error ───────────────────────────────────────────────────────────────

export class JobError extends IskraError {
    constructor(message: string, options?: { cause?: Error; context?: Record<string, unknown> }) {
        super(message, { code: ErrorCodes.JOB_ERROR, ...options });
        this.name = 'JobError';
    }
}
