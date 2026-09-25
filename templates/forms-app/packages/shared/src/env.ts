/**
 * Reads a secret from the environment. The services used to fall back to
 * secrets written in this repository (and docker-compose.yml to its own), so a
 * deployment that left one unset ran with a value anyone could read; with
 * AUTH_SECRET that is enough to sign an admin session. In production (the
 * Dockerfiles build with NODE_ENV=production) a missing, short or development
 * value stops the service at startup; elsewhere `devDefault` keeps `bun dev`
 * working without a .env.
 */
export function secretFromEnv(name: string, devDefault: string, { minLength = 32 } = {}): string {
    const value = process.env[name];
    if (process.env.NODE_ENV !== 'production') return value || devDefault;
    if (!value || value === devDefault) {
        throw new Error(`${name} must be set in production (see .env.example)`);
    }
    if (value.length < minLength) {
        throw new Error(`${name} must be at least ${minLength} characters long (openssl rand -base64 32)`);
    }
    return value;
}
