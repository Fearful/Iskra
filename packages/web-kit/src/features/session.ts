import type { Feature, SessionConfig } from "../types";
import type { Kernel } from "../kernel";
import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createHmac, timingSafeEqual } from "crypto";
import { sql, eq } from "drizzle-orm";
import { pgTable, text as pgText, bigint as pgBigint } from "drizzle-orm/pg-core";
import { mysqlTable, varchar as myVarchar, text as myText, bigint as myBigint } from "drizzle-orm/mysql-core";
import { sqliteTable, text as sqliteText, integer as sqliteInteger } from "drizzle-orm/sqlite-core";
import { consoleLogger, type KernelLogger } from "../logging";

// ─── Session Store Interface ─────────────────────────────────────────────────

interface SessionStore {
    get(id: string): Promise<Record<string, any> | null>;
    set(id: string, data: Record<string, any>, ttl: number): Promise<void>;
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
    private store = new Map<string, { data: Record<string, any>; expiresAt: number }>();
    private cleanupInterval: ReturnType<typeof setInterval>;

    constructor() {
        this.cleanupInterval = setInterval(() => this.cleanup(), 300_000);
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

    async set(id: string, data: Record<string, any>, ttl: number) {
        this.store.set(id, { data: structuredClone(data), expiresAt: Date.now() + ttl * 1000 });
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
    constructor(private cache: any) { }

    async get(id: string) {
        const data = await this.cache.get(`session:${id}`);
        return data ? structuredClone(data) : null;
    }

    async set(id: string, data: Record<string, any>, ttl: number) {
        await this.cache.set(`session:${id}`, structuredClone(data), ttl);
    }

    async destroy(id: string) {
        await this.cache.delete(`session:${id}`);
    }
}

// ─── DB Store ────────────────────────────────────────────────────────────────

type SessionDialect = "postgres" | "mysql" | "sqlite";

// One table definition per dialect (column types differ). The Drizzle query
// builder parameterizes every value, so user data in a session can never break
// out of a SQL string.
const sessionTables = {
    postgres: pgTable("sessions", {
        id: pgText("id").primaryKey(),
        data: pgText("data").notNull(),
        expiresAt: pgBigint("expires_at", { mode: "number" }).notNull(),
    }),
    mysql: mysqlTable("sessions", {
        id: myVarchar("id", { length: 255 }).primaryKey(),
        data: myText("data").notNull(),
        expiresAt: myBigint("expires_at", { mode: "number" }).notNull(),
    }),
    sqlite: sqliteTable("sessions", {
        id: sqliteText("id").primaryKey(),
        data: sqliteText("data").notNull(),
        expiresAt: sqliteInteger("expires_at").notNull(),
    }),
} as const;

const createTableDdl: Record<SessionDialect, string> = {
    postgres: "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at BIGINT NOT NULL)",
    mysql: "CREATE TABLE IF NOT EXISTS sessions (id VARCHAR(255) PRIMARY KEY, data TEXT NOT NULL, expires_at BIGINT NOT NULL)",
    sqlite: "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL)",
};

class DbSessionStore implements SessionStore {
    private initialized = false;
    private dialect: SessionDialect;
    private table: (typeof sessionTables)[SessionDialect];

    constructor(
        private db: any,
        dialect: SessionDialect = "sqlite",
        private log: KernelLogger = consoleLogger,
    ) {
        this.dialect = sessionTables[dialect] ? dialect : "sqlite";
        this.table = sessionTables[this.dialect];
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
            const ddl = sql.raw(createTableDdl[this.dialect]);
            // sqlite drivers expose run(); postgres/mysql expose execute().
            if (this.dialect === "sqlite") {
                await this.db.run(ddl);
            } else {
                await this.db.execute(ddl);
            }
            this.initialized = true;
        } catch (err) {
            this.retryAt = Date.now() + 5000;
            this.log.error("[session] Failed to ensure sessions table", err);
        }
    }

    async get(id: string) {
        await this.ensureTable();
        try {
            const rows = await this.db
                .select()
                .from(this.table)
                .where(eq(this.table.id, id))
                .limit(1);

            const row = rows?.[0];
            if (!row) return null;

            if (Date.now() > Number(row.expiresAt)) {
                await this.destroy(id);
                return null;
            }
            return JSON.parse(row.data);
        } catch (err) {
            this.log.error("[session] Failed to read session", err);
            return null;
        }
    }

    async set(id: string, data: Record<string, any>, ttl: number) {
        await this.ensureTable();
        const row = { id, data: JSON.stringify(data), expiresAt: Date.now() + ttl * 1000 };

        try {
            // Portable upsert: delete-then-insert works identically across all
            // three dialects without per-dialect ON CONFLICT / ON DUPLICATE syntax.
            await this.db.delete(this.table).where(eq(this.table.id, id));
            await this.db.insert(this.table).values(row);
        } catch (err) {
            this.log.error("[session] Failed to write session", err);
        }
    }

    async destroy(id: string) {
        try {
            await this.db.delete(this.table).where(eq(this.table.id, id));
        } catch (err) {
            this.log.error("[session] Failed to destroy session", err);
        }
    }
}

// ─── Cookie Signing ──────────────────────────────────────────────────────────

function signValue(value: string, secret: string): string {
    const signature = createHmac("sha256", secret).update(value).digest("base64url");
    return `${value}.${signature}`;
}

function verifySignedValue(signed: string, secret: string): string | null {
    const lastDot = signed.lastIndexOf(".");
    if (lastDot === -1) return null;

    const value = signed.substring(0, lastDot);
    const signature = signed.substring(lastDot + 1);
    const expected = createHmac("sha256", secret).update(value).digest("base64url");

    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return value;
}

/** Minimum length, in characters, for the cookie-signing secret (same bar as auth-kit). */
const MIN_SECRET_LENGTH = 32;

// ─── Session Feature ─────────────────────────────────────────────────────────

declare module "hono" {
    interface ContextVariableMap {
        session: Record<string, any>;
        sessionId: string;
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
    name = "session";
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
        this.cookieName = config.cookieName || "sid";

        // Set dependencies based on store type
        if (config.store === "cache") {
            this.dependencies = ["cache"];
        } else if (config.store === "db") {
            this.dependencies = ["db"];
        }
    }

    async initialize(kernel: Kernel): Promise<void> {
        const log = kernel.getLogger();
        log.debug(`Initializing Session: store=${this.config.store}`);
        // Cookies are Secure by default in production (override with cookieOptions.secure).
        this.secureDefault = (kernel.getConfig().environment ?? process.env.NODE_ENV) === "production";

        switch (this.config.store) {
            case "memory":
                this.store = new MemorySessionStore();
                break;
            case "cache": {
                const cacheFeature = kernel.getFeature("cache");
                if (!cacheFeature?.client) {
                    log.warn("Cache feature not available, falling back to memory session store");
                    this.store = new MemorySessionStore();
                } else {
                    this.store = new CacheSessionStore(cacheFeature.client);
                }
                break;
            }
            case "db": {
                const dbFeature = kernel.getFeature("db");
                if (!dbFeature?.db) {
                    log.warn("DB feature not available, falling back to memory session store");
                    this.store = new MemorySessionStore();
                } else {
                    this.store = new DbSessionStore(dbFeature.db, dbFeature.adapter, log);
                }
                break;
            }
        }

        const app = kernel.getApp();
        app.use("*", async (c: Context, next: Next) => {
            const signedCookie = getCookie(c, this.cookieName);
            let sessionId: string | null = null;
            let session: Record<string, any> = {};

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
                path: opts.path || "/",
            };

            c.set("session", session);
            c.set("sessionId", sessionId);
            c.set("destroySession", async () => {
                destroyed = true;
                await this.store!.destroy(sessionId!);
                deleteCookie(c, this.cookieName, cookieOptions);
            });
            c.set("regenerateSession", async () => {
                if (persisted) await this.store!.destroy(sessionId!);
                persisted = false;
                sessionId = crypto.randomUUID();
                c.set("sessionId", sessionId);
            });

            await next();

            // A destroyed session must not be re-persisted (otherwise the save
            // block below would immediately recreate it and override deleteCookie).
            if (destroyed) return;

            // Save session after response
            const currentSession = c.get("session");
            if (currentSession && Object.keys(currentSession).length > 0) {
                // A session this request loaded but another request destroyed
                // meanwhile (a logout, a login's regenerateSession) must stay
                // gone: re-saving it undid the logout, or revived the ID an
                // attacker fixed before the victim logged in. The cookie is left
                // alone, since the other request may have just set a new one.
                if (persisted && !(await this.store!.get(sessionId))) return;
                await this.store!.set(sessionId, currentSession, this.ttl);
                const signed = signValue(sessionId, this.config.secret);
                setCookie(c, this.cookieName, signed, {
                    ...cookieOptions,
                    httpOnly: true,
                    sameSite: opts.sameSite || "Lax",
                    secure: opts.secure ?? (this.secureDefault || opts.sameSite === "None"),
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

        log.debug("Session initialized");
    }

    async shutdown(): Promise<void> {
        if (this.store instanceof MemorySessionStore) {
            (this.store as any).dispose?.();
        }
    }
}
