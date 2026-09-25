// Words of example values ("change-me", "your-secret-key"...), compared
// without case or separators, as auth-kit does for AUTH_SECRET.
const PLACEHOLDER = /changeme|devsecret|devonly|yoursecret|placeholder/;

/**
 * Reads a secret from the environment. The services used to fall back to
 * secrets written in this repository (and docker-compose.yml to its own), so a
 * deployment that left one unset ran with a value anyone could read; with
 * AUTH_SECRET that is enough to sign an admin session. In production (the
 * Dockerfiles build with NODE_ENV=production) a missing, short, development or
 * placeholder value stops the service at startup; elsewhere `devDefault` keeps
 * `bun dev` working without a .env.
 */
export function secretFromEnv(name: string, devDefault: string, { minLength = 32 } = {}): string {
    const value = process.env[name];
    if (process.env.NODE_ENV !== 'production') return value || devDefault;
    if (!value || value === devDefault || PLACEHOLDER.test(value.toLowerCase().replace(/[-_.\s]/g, ''))) {
        throw new Error(`${name} must be set in production, to a value of your own (see .env.example)`);
    }
    if (value.length < minLength) {
        throw new Error(`${name} must be at least ${minLength} characters long (openssl rand -base64 32)`);
    }
    return value;
}
