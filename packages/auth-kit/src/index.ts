export {
    createBetterAuth,
    type Auth,
    type AuthKitDrizzleDb,
    type BetterAuthConfigOptions,
} from "./better-auth-config";

export {
    pgUser,
    pgSession,
    pgAccount,
    pgVerification,
    pgSchema,
    mysqlUser,
    mysqlSession,
    mysqlAccount,
    mysqlVerification,
    mysqlSchema,
    sqliteUser,
    sqliteSession,
    sqliteAccount,
    sqliteVerification,
    sqliteSchema,
} from "./schema";

export type {
    User,
    Account,
    Verification,
    AuthSession,
    PasswordResetToken,
    EmailVerificationToken,
    AuthContext,
    SignUpInput,
    SignInInput,
    PasswordResetRequest,
    PasswordResetConfirm,
    EmailVerificationRequest,
} from "./types";
