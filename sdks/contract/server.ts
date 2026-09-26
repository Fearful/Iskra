/**
 * SDK contract server: a real Iskra app (web-kit Kernel + AuthFeature on
 * in-memory SQLite + HealthCheckFeature + StorageFeature/UploadFeature +
 * ErrorHandlerFeature) that the Python and Java SDK test suites run against,
 * so the SDKs are checked against the server's actual responses instead of
 * hand-written fixtures.
 *
 *   bun run sdks/contract/server.ts
 *
 * Listens on 127.0.0.1 on a free port (or $CONTRACT_PORT) and prints one line
 * `ISKRA_CONTRACT_READY {"port":N,"baseUrl":"..."}` once it accepts requests.
 * With CONTRACT_EXIT_ON_STDIN_EOF=1 it also exits when its stdin closes, so a
 * test harness that dies without killing it does not leave it running.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    AuthError,
    AuthFeature,
    ConflictError,
    DbFeature,
    ErrorHandlerFeature,
    ForbiddenError,
    HealthCheckFeature,
    Kernel,
    NotFoundError,
    StorageFeature,
    UploadFeature,
    ValidationError,
    createHttpError,
    successResponse,
} from '@iskra-bun/web-kit';

export const AUTH_BASE_PATH = '/api/sso';
export const UPLOAD_PREFIX = '/upload';
export const PROJECT_NAME = 'contract';

// Better Auth's sqlite schema (same DDL as auth-kit's integration test).
const SQLITE_DDL = `
CREATE TABLE user (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT NOT NULL UNIQUE,
    emailVerified INTEGER NOT NULL,
    image TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
);
CREATE TABLE session (
    id TEXT PRIMARY KEY,
    expiresAt INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    ipAddress TEXT,
    userAgent TEXT,
    userId TEXT NOT NULL REFERENCES user(id)
);
CREATE TABLE account (
    id TEXT PRIMARY KEY,
    accountId TEXT NOT NULL,
    providerId TEXT NOT NULL,
    userId TEXT NOT NULL REFERENCES user(id),
    accessToken TEXT,
    refreshToken TEXT,
    idToken TEXT,
    accessTokenExpiresAt INTEGER,
    refreshTokenExpiresAt INTEGER,
    scope TEXT,
    password TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
);
CREATE TABLE verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expiresAt INTEGER NOT NULL,
    createdAt INTEGER,
    updatedAt INTEGER
);
`;

function freePort(): number {
    const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
    const port = probe.port;
    probe.stop(true);
    if (!port) throw new Error('could not find a free port');
    return port;
}

export interface ContractServer {
    baseUrl: string;
    port: number;
    stop(): Promise<void>;
}

export async function startContractServer(port = freePort()): Promise<ContractServer> {
    const baseUrl = `http://127.0.0.1:${port}`;
    const storageDir = mkdtempSync(join(tmpdir(), 'iskra-contract-'));
    let healthy = true;

    const kernel = new Kernel({ port, hostname: '127.0.0.1', shutdownGraceMs: 500 });
    const db = new DbFeature({ adapter: 'sqlite', connection: { database: ':memory:' } });
    kernel.registerFeature(new ErrorHandlerFeature());
    kernel.registerFeature(db);
    kernel.registerFeature(
        new AuthFeature({
            secret: 'contract-server-secret-at-least-32-chars',
            baseURL: baseUrl,
            basePath: AUTH_BASE_PATH,
            authMode: 'email',
            // The SDK suites sign many users in from one IP.
            rateLimit: false,
        }),
    );
    kernel.registerFeature(
        new HealthCheckFeature({
            checks: { contract: async () => ({ status: healthy ? 'ok' : 'error' }) },
        }),
    );
    kernel.registerFeature(new StorageFeature({ adapter: 'local', basePath: storageDir }));
    kernel.registerFeature(
        new UploadFeature({
            projectName: PROJECT_NAME,
            exposeRoutes: true,
            routePrefix: UPLOAD_PREFIX,
            maxFileSize: 1024 * 1024,
            // Any signed-in user may use any folder: the SDK suites upload to
            // arbitrary subfolders. Do not copy this into an app, where it lets
            // every user list, download and delete everyone's files; scope each
            // user to a folder of their own instead (as the SDK READMEs show):
            //   authorize: (c, action) => {
            //       const user = c.get('user');
            //       const folder = action === 'upload' || action === 'list'
            //           ? c.req.query('subfolder')
            //           : c.req.path.slice(`${UPLOAD_PREFIX}/`.length).split('/').slice(0, -1).join('/');
            //       return !!user && folder === `users/${user.id}`;
            //   },
            authorize: (c) => Boolean(c.get('user')),
        }),
    );
    await kernel.initialize();
    (db.db as unknown as { $client: { exec(sql: string): void } }).$client.exec(SQLITE_DDL);

    const app = kernel.getApp();
    // Response shapes an Iskra app produces for its own routes.
    app.get('/contract/envelope', (c) => c.json(successResponse({ items: [1, 2, 3] }, 'listed')));
    app.get('/contract/raw', (c) => c.json([{ id: 1 }, { id: 2 }]));
    app.get('/contract/text', (c) => c.text('pong'));
    app.post('/contract/echo', async (c) => c.json(await c.req.json()));
    app.put('/contract/echo', async (c) => c.json(await c.req.json()));
    app.delete('/contract/echo', (c) => c.body(null, 204));
    app.get('/contract/query', (c) => c.json(c.req.queries()));
    app.get('/contract/headers', (c) =>
        c.json({ apiKey: c.req.header('x-api-key') ?? null, custom: c.req.header('x-custom') ?? null }),
    );
    app.get('/contract/not-found', () => {
        throw new NotFoundError('Widget not found');
    });
    app.post('/contract/validate', () => {
        throw new ValidationError('Invalid widget', { field: 'name', issue: 'required' });
    });
    app.get('/contract/forbidden', () => {
        throw new ForbiddenError('Not your widget');
    });
    app.post('/contract/conflict', () => {
        throw new ConflictError('Widget already exists');
    });
    // Answers like RateLimitFeature, plus a Retry-After header: 7 seconds, or
    // `?retryAfter=` as given (an empty value leaves the header out).
    app.get('/contract/rate-limited', (c) => {
        const retryAfter = c.req.query('retryAfter') ?? '7';
        if (retryAfter) c.header('Retry-After', retryAfter);
        throw createHttpError(429, 'Too many requests');
    });
    app.get('/contract/me', (c) => {
        const user = c.get('user');
        if (!user) throw new AuthError();
        return c.json(successResponse({ id: user.id, email: user.email }));
    });
    app.post('/contract/health', async (c) => {
        healthy = Boolean((await c.req.json()).healthy);
        return c.body(null, 204);
    });

    await kernel.start();

    return {
        baseUrl,
        port,
        async stop() {
            await kernel.shutdown();
            rmSync(storageDir, { recursive: true, force: true });
        },
    };
}

if (import.meta.main) {
    const envPort = Number(process.env.CONTRACT_PORT);
    const server = await startContractServer(envPort > 0 ? envPort : undefined);
    let stopping = false;
    const stop = async () => {
        if (stopping) return;
        stopping = true;
        await server.stop().catch(() => {});
        process.exit(0);
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
    if (process.env.CONTRACT_EXIT_ON_STDIN_EOF === '1') {
        process.stdin.on('end', stop);
        process.stdin.on('close', stop);
        process.stdin.resume();
    }
    // eslint-disable-next-line no-console -- the harness reads this line
    console.log(`ISKRA_CONTRACT_READY ${JSON.stringify({ port: server.port, baseUrl: server.baseUrl })}`);
}
