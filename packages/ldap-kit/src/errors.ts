import { ErrorCodes, IskraError, type ErrorCode } from '@iskra-bun/core';

/**
 * The directory failed: it could not be reached (`SERVICE_UNAVAILABLE`,
 * 503 through web-kit), it took too long (`TIMEOUT`), or it refused an
 * operation (`INTERNAL_ERROR`, with `context.resultCode`). A wrong password
 * is not one: `authenticate()` answers it. The original error is `cause`.
 */
export class LdapError extends IskraError {
    constructor(message: string, options: { code?: ErrorCode; cause?: Error; context?: Record<string, unknown> } = {}) {
        super(message, { ...options, code: options.code ?? ErrorCodes.INTERNAL_ERROR });
        this.name = 'LdapError';
    }

    /** The LDAP result code, when the server answered one (32: no such object, 49: invalid credentials). */
    get resultCode(): number | undefined {
        const value = this.context.resultCode;
        return typeof value === 'number' ? value : undefined;
    }
}
