/**
 * Auth feature types and interfaces
 */

export interface User {
    id: string;
    email: string;
    emailVerified: boolean;
    name?: string | null;
    image?: string | null;
    createdAt: Date;
    updatedAt: Date;
    /** Custom fields: narrow them where they are read. */
    [key: string]: unknown;
}

export interface Account {
    id: string;
    userId: string;
    accountId: string;
    providerId: string;
    accessToken?: string;
    refreshToken?: string;
    idToken?: string;
    expiresAt?: Date;
    scope?: string;
    password?: string; // For credentials provider
    createdAt: Date;
    updatedAt: Date;
}

export interface Verification {
    id: string;
    identifier: string; // email or phone
    value: string; // verification token
    expiresAt: Date;
    createdAt: Date;
}

export interface AuthSession {
    id: string;
    userId: string;
    expiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface PasswordResetToken {
    id: string;
    userId: string;
    token: string;
    expiresAt: Date;
    createdAt: Date;
}

export interface EmailVerificationToken {
    id: string;
    userId: string;
    token: string;
    email: string;
    expiresAt: Date;
    createdAt: Date;
}

/**
 * Auth context available in route handlers
 */
export interface AuthContext {
    user: User | null;
    session: AuthSession | null;
}

/**
 * Registration input
 */
export interface SignUpInput {
    email: string;
    password: string;
    name?: string;
    /** Custom fields: narrow them where they are read. */
    [key: string]: unknown;
}

/**
 * Login input
 */
export interface SignInInput {
    email: string;
    password: string;
}

/**
 * Password reset request
 */
export interface PasswordResetRequest {
    email: string;
}

/**
 * Password reset confirmation
 */
export interface PasswordResetConfirm {
    token: string;
    newPassword: string;
}

/**
 * Email verification
 */
export interface EmailVerificationRequest {
    token: string;
}
