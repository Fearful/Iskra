import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// docker-compose.yml is how the stack is started (and what deployments copy):
// these check its security settings without running Docker.
interface Service {
    command?: string[];
    environment?: Record<string, string>;
    networks?: string[];
    ports?: string[];
}

const text = readFileSync(join(import.meta.dir, '..', 'docker-compose.yml'), 'utf8');
const { services } = Bun.YAML.parse(text) as { services: Record<string, Service> };

const SECRETS = [
    'DB_PASSWORD',
    'REDIS_PASSWORD',
    'AUTH_SECRET',
    'INTERNAL_API_TOKEN',
    'CSRF_SECRET',
    'IP_HASH_SECRET',
    'RECAPTCHA_SECRET',
];

/** Services that share a network with `name`, so can connect to any of its ports. */
function reachableFrom(name: string): string[] {
    const own = services[name].networks ?? ['default'];
    return Object.keys(services).filter(
        (other) => other !== name && (services[other].networks ?? ['default']).some((n) => own.includes(n)),
    );
}

describe('docker-compose.yml', () => {
    it('has no default for any secret', () => {
        // `${AUTH_SECRET:-dev-only-...}` and the like used to reach production.
        for (const name of SECRETS) {
            const uses = [...text.matchAll(new RegExp(`\\$\\{${name}([^}]*)\\}`, 'g'))].map((m) => m[1]);
            expect(uses.length).toBeGreaterThan(0);
            for (const use of uses) expect(use).toStartWith(':?');
        }
    });

    it('publishes Postgres and Redis on the loopback interface only', () => {
        expect(services.postgres.ports).toEqual(['127.0.0.1:5432:5432']);
        expect(services.redis.ports).toEqual(['127.0.0.1:6379:6379']);
        const published = Object.entries(services).filter(([name]) => name !== 'nginx');
        for (const port of published.flatMap(([, service]) => service.ports ?? [])) {
            expect(port).toStartWith('127.0.0.1:');
        }
    });

    it('requires the Redis password from every client', () => {
        expect(services.redis.command).toEqual([
            'redis-server',
            '--requirepass',
            expect.stringContaining('REDIS_PASSWORD'),
        ]);
        const clients = Object.entries(services).filter(([, s]) => s.environment?.REDIS_URL);
        expect(clients.map(([name]) => name).sort()).toEqual(['answer-writer', 'cron', 'form-manager', 'forms-api']);
        for (const [, service] of clients) {
            expect(service.environment!.REDIS_URL).toStartWith('redis://:${REDIS_PASSWORD');
        }
    });

    it("gives form-manager's internal API token to form-manager and its callers only", () => {
        const holders = Object.entries(services).filter(([, s]) => s.environment?.INTERNAL_API_TOKEN);
        expect(holders.map(([name]) => name).sort()).toEqual(['admin-api', 'cron', 'form-manager']);
    });

    it('lets forms-api reach nginx and Redis only', () => {
        // One flat network used to put the public service next to Postgres
        // and form-manager's unauthenticated /internal API.
        expect(reachableFrom('forms-api').sort()).toEqual(['nginx', 'redis']);
    });

    it('keeps Postgres and form-manager off the edge', () => {
        expect(reachableFrom('nginx').sort()).toEqual(['admin-api', 'admin-frontend', 'forms-api']);
        expect(reachableFrom('postgres').sort()).toEqual(['admin-api', 'answer-writer', 'cron', 'form-manager']);
        expect(reachableFrom('form-manager')).not.toContain('forms-api');
    });
});
