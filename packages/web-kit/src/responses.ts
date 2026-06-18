export interface SuccessResponse<T = unknown> {
    success: true;
    data?: T;
    message?: string;
}

export interface ErrorResponse {
    success: false;
    error: string;
    code?: string;
    details?: unknown;
    timestamp?: string;
}

export type ApiResponse<T = unknown> = SuccessResponse<T> | ErrorResponse;

export function successResponse<T = unknown>(data?: T, message?: string): SuccessResponse<T> {
    const response: SuccessResponse<T> = { success: true };
    if (data !== undefined) response.data = data;
    if (message) response.message = message;
    return response;
}

export function errorResponse(error: string | Error, code?: string, details?: unknown): ErrorResponse {
    const message = error instanceof Error ? error.message : error;
    const response: ErrorResponse = {
        success: false,
        error: message,
        timestamp: new Date().toISOString(),
    };
    if (code) response.code = code;
    if (details !== undefined) response.details = details;
    return response;
}

// Re-exportado desde @iskra-bun/core para compatibilidad
export { ErrorCodes, type ErrorCode } from '@iskra-bun/core';
