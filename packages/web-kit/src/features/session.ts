import type { Feature, SessionConfig } from '../types';
import type { Kernel } from '../kernel';
import type { Context, Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createHmac, timingSafeEqual } from 'crypto';
import { sql, eq, and, gte } from 'drizzle-orm';
import { pgTable, text as pgText, bigint as pgBigint } from 'drizzle-orm/pg-core';
import { mysqlTable, varchar as myVarchar, text as myText, bigint as myBigint } from 'drizzle-orm/mysql-core';
import { sqliteTable, text as sqliteText, integer as sqliteInteger } from 'drizzle-orm/sqlite-core';
import { consoleLogger, type KernelLogger } from '../logging';
import type { WebKitDrizzleDb } from './db';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { CacheAdapter } from './cache';

/**
 * What a request's session holds (`c.get("session")`): JSON-serializable data.
 * Declare your fields with declaration merging and they are typed everywhere:
 *
 * ```ts
 * declare module "@iskra-bun/web-kit" {
 *     interface SessionData {
 *         userId?: string;
 *     }
 * }
 * ```
 */
export interface SessionData {
    [key: string]: unknown;
}

// ─── Session Store Interface ─────────────────────────────────────────────────

interface SessionStore {
    get(id: string): Promise<SessionData | null>;
    set(id: string, data: SessionData, ttl: number): Promise<void>;
    /**
     * Saves a session only if it still exists, checked and written in one
     * step; false (nothing written) when it is gone.
     */
    update(id: string, data: SessionData, ttl: number): Promise<boolean>;
    destroy(id: string): Promise<void>;
}

// ─── Memory Store ────────────────────────────────────────────────────────────

/**
 * Keeps a copy of the data and hands out copies (data must be
 * structured-cloneable, as it already had to be JSON for the other stores):
 * handing every request the stored object let one request's changes (a login
 * setting `userId`) reach another request's session and be saved under its ID.
 */
class MemorySessionStore implements SessionStore {
    private store = new Map<string, { data: SessionData; expiresAt: number }>();
    private cleanupInterval: ReturnType<typeof setInterval>;

    constructor() {
        this.cleanupInterval = setInterval(() => this.cleanup(), 300_000);
        // A store nobody shut down must not keep the process alive.
        this.cleanupInterval.unref?.();
    }

    async get(id: string) {
        const entry = this.store.get(id);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
            this.store.delete(id);
            return null;
        }
        return structuredClone(entry.data);
    }

    async set(id: string, data: SessionData, ttl: number) {
        this.store.set(id, { data: structuredClone(data), expiresAt: Date.now() + ttl * 1000 });
    }

    async update(id: string, data: SessionData, ttl: number) {
        const entry = this.store.get(id);
        if (!entry || Date.now() > entry.expiresAt) return false;
        this.store.set(id, { data: structuredClone(data), expiresAt: Date.now() + ttl * 1000 });
        return true;
    }

    async destroy(id: string) {
        this.store.delete(id);
    }

    private cleanup() {
        const now = Date.now();
        for (const [key, entry] of this.store.entries()) {
            if (now > entry.expiresAt) this.store.delete(key);
        }
    }

    dispose() {
        clearInterval(this.cleanupInterval);
    }
}

// ─── Cache Store ─────────────────────────────────────────────────────────────

/** Copies in and out for the same reason as MemorySessionStore: the cache's memory adapter keeps references. */
class CacheSessionStore implements SessionStore {
    constructor(private cache: CacheAdapter) {}

    async get(id: string): Promise<SessionData | null> {
        const data = await this.cache.get(`session:${id}`);
        // Only set() writes under this key, always with a session object.
        return data && typeof data === 'object' ? (structuredClone(data) as SessionData) : null;
    }

    async set(id: string, data: SessionData, ttl: number) {
        await this.cache.set(`session:${id}`, structuredClone(data), ttl);
    }

    async update(id: string, data: SessionData, ttl: number) {
        // One command on Redis (SET ... XX): a destroy() can no longer land
        // between a check and the write.
        if (this.cache.setIfExists) return this.cache.setIfExists(`session:${id}`, structuredClone(data), ttl);

        // Fallback for custom adapters: not atomic.
        if (!(await this.get(id))) return false;
        await this.set(id, data, ttl);
        return true;
    }

    async destroy(id: string) {
        await this.cache.delete(`session:${id}`);
    }
}

// ─── DB Store ────────────────────────────────────────────────────────────────

type SessionDialect = 'postgres' | 'mysql' | 'sqlite';

// One table definition per dialect (column types differ). The Drizzle query
// builder parameterizes every value, so user data in a session can never break
// out of a SQL string.
const sessionTables = {
    postgres: pgTable('sessions', {
        id: pgText('id').primaryKey(),
        data: pgText('data').notNull(),
        expiresAt: pgBigint('expires_at', { mode: 'number' }).notNull(),
    }),
    mysql: mysqlTable('sessions', {
        id: myVarchar('id', { length: 255 }).primaryKey(),
        data: myText('data').notNull(),
        expiresAt: myBigint('expires_at', { mode: 'number' }).notNull(),
    }),
    sqlite: sqliteTable('sessions', {
        id: sqliteText('id').primaryKey(),
        data: sqliteText('data').notNull(),
        expiresAt: sqliteInteger('expires_at').notNull(),
    }),
} as const;

const createTableDdl: Record<SessionDialect, string> = {
    postgres:
        'CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at BIGINT NOT NULL)',
    mysql: 'CREATE TABLE IF NOT EXISTS sessions (id VARCHAR(255) PRIMARY KEY, data TEXT NOT NULL, expires_at BIGINT NOT NULL)',
    sqlite: 'CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL)',
};

/** A stored session row. */
interface SessionRow {
    id: string;
    data: string;
    expiresAt: number;
}

/** The table operations DbSessionStore needs, typed for one dialect. */
interface SessionTable {
    create(): Promise<unknown>;
    find(id: string): Promise<SessionRow | undefined>;
    remove(id: string): Promise<unknown>;
    insert(row: SessionRow): Promise<unknown>;
    /** Rewrites the row if it exists and has not expired; whether it did. */
    update(row: SessionRow): Promise<boolean>;
}

/**
 * Drizzle's builders cannot be called on a union of dialect databases, so each
 * dialect gets its own typed implementation. `db` is the DbFeature's handle for
 * `dialect` (the feature's configured adapter), hence the one narrowing cast.
 */
function sessionTableFor(db: WebKitDrizzleDb<Record<string, unknown>>, dialect: SessionDialect): SessionTable {
    const ddl = sql.raw(createTableDdl[dialect]);
    switch (dialect) {
        case 'postgres': {
            const pg = db as PostgresJsDatabase<Record<string, unknown>>;
            const t = sessionTables.postgres;
            return {
                create: () => pg.execute(ddl),
                find: async (id) => (await pg.select().from(t).where(eq(t.id, id)).limit(1))[0],
                remove: (id) => pg.delete(t).where(eq(t.id, id)),
                insert: (row) => pg.insert(t).values(row),
                update: async ({ id, data, expiresAt }) =>
                    (
                        await pg
                            .update(t)
                            .set({ data, expiresAt })
                            .where(and(eq(t.id, id), gte(t.expiresAt, Date.now())))
                            .returning({ id: t.id })
                    ).length > 0,
            };
        }
        case 'mysql': {
            const my = db as MySql2Database<Record<string, unknown>>;
            const t = sessionTables.mysql;
            return {
                create: () => my.execute(ddl),
                find: async (id) => (await my.select().from(t).where(eq(t.id, id)).limit(1))[0],
                remove: (id) => my.delete(t).where(eq(t.id, id)),
                insert: (row) => my.insert(t).values(row),
                // No RETURNING in MySQL; mysql2 reports matched rows (FOUND_ROWS).
                update: async ({ id, data, expiresAt }) => {
                    const [result] = await my
                        .update(t)
                        .set({ data, expiresAt })
                        .where(and(eq(t.id, id), gte(t.expiresAt, Date.now())));
                    return result.affectedRows > 0;
                },
            };
        }
        case 'sqlite': {
            const lite = db as BunSQLiteDatabase<Record<string, unknown>>;
            const t = sessionTables.sqlite;
            return {
                create: async () => lite.run(ddl),
                find: async (id) => (await lite.select().from(t).where(eq(t.id, id)).limit(1))[0],
                remove: async (id) => lite.delete(t).where(eq(t.id, id)),
                insert: async (row) => lite.insert(t).values(row),
                update: async ({ id, data, expiresAt }) =>
                    (
                        await lite
                            .update(t)
                            .set({ data, expiresAt })
                            .where(and(eq(t.id, id), gte(t.expiresAt, Date.now())))
                            .returning({ id: t.id })
                    ).length > 0,
            };
        }
    }
}

class DbSessionStore implements SessionStore {
    private initialized = false;
    private table: SessionTable;

    constructor(
        db: WebKitDrizzleDb<Record<string, unknown>>,
        dialect: SessionDialect = 'sqlite',
        private log: KernelLogger = consoleLogger,
    ) {
        this.table = sessionTableFor(db, sessionTables[dialect] ? dialect : 'sqlite');
    }

    /** No new CREATE TABLE attempt before this time, after a failed one. */
    private retryAt = 0;

    /**
     * Creates the table once. A failure (the database not reachable yet, say)
     * is retried on a later request, at most every 5 s: it used to be marked
     * done anyway, so the table was never created and every login set a cookie
     * for a session that could not be stored.
     */
    private async ensureTable() {
        if (this.initialized || Date.now() < this.retryAt) return;
        try {
            await this.table.create();
            this.initialized = true;
        } catch (err) {
            this.retryAt = Date.now() + 5000;
            this.log.error('[session] Failed to ensure sessions table', err);
        }
    }

    async get(id: string): Promise<SessionData | null> {
        await this.ensureTable();
        try {
            const row = await this.table.find(id);
            if (!row) return null;

            if (Date.now() > Number(row.expiresAt)) {
                await this.destroy(id);
                return null;
            }
            return JSON.parse(row.data) as SessionData;
        } catch (err) {
            this.log.error('[session] Failed to read session', err);
            return null;
        }
    }

    async set(id: string, data: SessionData, ttl: number) {
        await this.ensureTable();
        const row = { id, data: JSON.stringify(data), expiresAt: Date.now() + ttl * 1000 };

        try {
            // Portable upsert: delete-then-insert works identically across all
            // three dialects without per-dialect ON CONFLICT / ON DUPLICATE syntax.
            await this.table.remove(id);
            await this.table.insert(row);
        } catch (err) {
            this.log.error('[session] Failed to write session', err);
        }
    }

    async update(id: string, data: SessionData, ttl: number) {
        await this.ensureTable();
        try {
            // An UPDATE, not the upsert: a row another request deleted
            // meanwhile stays deleted.
            return await this.table.update({ id, data: JSON.stringify(data), expiresAt: Date.now() + ttl * 1000 });
        } catch (err) {
            this.log.error('[session] Failed to write session', err);
            return false;
        }
    }

    async destroy(id: string) {
        try {
            await this.table.remove(id);
        } catch (err) {
            this.log.error('[session] Failed to destroy session', err);
        }
    }
}

// ─── Cookie Signing ──────────────────────────────────────────────────────────

function signValue(value: string, secret: string): string {
    const signature = createHmac('sha256', secret).update(value).digest('base64url');
    return `${value}.${signature}`;
}

function verifySignedValue(signed: string, secret: string): string | null {
    const lastDot = signed.lastIndexOf('.');
    if (lastDot === -1) return null;

    const value = signed.substring(0, lastDot);
    const signature = signed.substring(lastDot + 1);
    const expected = createHmac('sha256', secret).update(value).digest('base64url');

    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return value;
}

/** Minimum length, in characters, for the cookie-signing secret (same bar as auth-kit). */
const MIN_SECRET_LENGTH = 32;

// ─── Session Feature ─────────────────────────────────────────────────────────

declare module 'hono' {
    interface ContextVariableMap {
        session: SessionData;
        sessionId: string;
        /**
         * Whether `sessionId` names a stored session: false for a new one (it
         * is stored at the end of the request if the handler puts data in it)
         * and after `destroySession()` or `regenerateSession()`.
         */
        sessionPersisted: boolean;
        destroySession: () => Promise<void>;
        /**
         * Issues a new session ID for the current data and invalidates the old
         * one. Call it right after login (or any privilege change) so an ID the
         * client had before authenticating cannot be reused (session fixation).
         */
        regenerateSession: () => Promise<void>;
    }
}

export class SessionFeature implements Feature {
    name = 'session';
    dependencies?: string[];

    private store?: SessionStore;
    private ttl: number;
    private cookieName: string;
    private secureDefault = false;

    constructor(private config: SessionConfig) {
        // The secret signs session cookies; a short one can be brute-forced offline.
        if (!config.secret || config.secret.length < MIN_SECRET_LENGTH) {
            throw new Error(
                `session secret must be at least ${MIN_SECRET_LENGTH} characters; received ${config.secret ? config.secret.length : 0}`,
            );
        }
        this.ttl = config.ttl || 86400; // 24 hours default
        this.cookieName = config.cookieName || 'sid';

        // Set dependencies based on store type
        if (config.store === 'cache') {
            this.dependencies = ['cache'];
        } else if (config.store === 'db') {
            this.dependencies = ['db'];
        }
    }

    async initialize(kernel: Kernel): Promise<void> {
        const log = kernel.getLogger();
        log.debug(`Initializing Session: store=${this.config.store}`);
        // Cookies are Secure by default in production (override with cookieOptions.secure).
        this.secureDefault = (kernel.getConfig().environment ?? process.env.NODE_ENV) === 'production';

        switch (this.config.store) {
            case 'memory':
                this.store = new MemorySessionStore();
                break;
            case 'cache': {
                const cacheFeature = kernel.getFeature('cache');
                if (!cacheFeature?.client) {
                    log.warn('Cache feature not available, falling back to memory session store');
                    this.store = new MemorySessionStore();
                } else {
                    this.store = new CacheSessionStore(cacheFeature.client);
                }
                break;
            }
            case 'db': {
                const dbFeature = kernel.getFeature('db');
                if (!dbFeature?.db) {
                    log.warn('DB feature not available, falling back to memory session store');
                    this.store = new MemorySessionStore();
                } else {
                    this.store = new DbSessionStore(dbFeature.db, dbFeature.adapter, log);
                }
                break;
            }
        }

        const app = kernel.getApp();
        app.use('*', async (c: Context, next: Next) => {
            const signedCookie = getCookie(c, this.cookieName);
            let sessionId: string | null = null;
            let session: SessionData = {};

            if (signedCookie) {
                sessionId = verifySignedValue(signedCookie, this.config.secret);
                if (sessionId) {
                    const data = await this.store!.get(sessionId);
                    if (data) {
                        session = data;
                    } else {
                        sessionId = null; // Session expired or not found
                    }
                }
            }

            // Whether a stored session backs this request (and must be cleaned
            // up if the handler empties it).
            let persisted = sessionId !== null;
            if (!sessionId) {
                sessionId = crypto.randomUUID();
            }

            let destroyed = false;
            const opts = this.config.cookieOptions || {};
            const cookieOptions = {
                domain: opts.domain,
                path: opts.path || '/',
            };

            c.set('session', session);
            c.set('sessionId', sessionId);
            c.set('sessionPersisted', persisted);
            c.set('destroySession', async () => {
                destroyed = true;
                c.set('sessionPersisted', false);
                await this.store!.destroy(sessionId!);
                deleteCookie(c, this.cookieName, cookieOptions);
            });
            c.set('regenerateSession', async () => {
                if (persisted) await this.store!.destroy(sessionId!);
                persisted = false;
                sessionId = crypto.randomUUID();
                c.set('sessionId', sessionId);
                c.set('sessionPersisted', false);
            });

            await next();

            // A destroyed session must not be re-persisted (otherwise the save
            // block below would immediately recreate it and override deleteCookie).
            if (destroyed) return;

            // Save session after response
            const currentSession = c.get('session');
            if (currentSession && Object.keys(currentSession).length > 0) {
                // A session this request loaded but another request destroyed
                // meanwhile (a logout, a login's regenerateSession) must stay
                // gone: re-saving it undid the logout, or revived the ID an
                // attacker fixed before the victim logged in. The cookie is left
                // alone, since the other request may have just set a new one.
                // update() checks and writes in one step: a get() then a set()
                // let a destroy() on Redis or a database land in between.
                if (persisted) {
                    if (!(await this.store!.update(sessionId, currentSession, this.ttl))) return;
                } else {
                    await this.store!.set(sessionId, currentSession, this.ttl);
                }
                const signed = signValue(sessionId, this.config.secret);
                setCookie(c, this.cookieName, signed, {
                    ...cookieOptions,
                    httpOnly: true,
                    sameSite: opts.sameSite || 'Lax',
                    secure: opts.secure ?? (this.secureDefault || opts.sameSite === 'None'),
                    maxAge: this.ttl,
                });
            } else if (persisted) {
                // The handler cleared the session (e.g. `delete session.userId`
                // on logout, or `c.set("session", {})`): drop the stored copy,
                // or the old data would load again on the next request.
                await this.store!.destroy(sessionId);
                deleteCookie(c, this.cookieName, cookieOptions);
            }
        });

        log.debug('Session initialized');
    }

    async shutdown(): Promise<void> {
        if (this.store instanceof MemorySessionStore) {
            this.store.dispose();
        }
    }
}
