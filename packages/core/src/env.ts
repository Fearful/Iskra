/**
 * The deployment environment, read when called: `NODE_ENV` through a computed
 * key, because `bun build` replaces a literal `process.env.NODE_ENV` with its
 * value at build time ("development" when unset), so a compiled binary ignored
 * the NODE_ENV it ran with.
 */
const NODE_ENV = 'NODE_ENV';

/** `NODE_ENV` as the process runs with it, or undefined when unset or empty. */
export function nodeEnv(): string | undefined {
    return process.env[NODE_ENV] || undefined;
}

/**
 * Whether development conveniences apply (pretty logs, http auth URLs, sample
 * secrets, `disableCSRFCheck`): only with `NODE_ENV` set to `development` or
 * `test`.
 */
export function isDevelopmentEnv(env: string | undefined = nodeEnv()): boolean {
    return env === 'development' || env === 'test';
}

/**
 * Whether production safeguards apply: in every environment but `development`
 * and `test`, including an unset NODE_ENV and names like `staging`. They used
 * to apply only to NODE_ENV=production exactly, so a deploy that forgot it
 * sent non-Secure cookies and accepted placeholder secrets.
 */
export function isProductionEnv(env: string | undefined = nodeEnv()): boolean {
    return !isDevelopmentEnv(env);
}
