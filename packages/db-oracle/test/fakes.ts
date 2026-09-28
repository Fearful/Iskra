import { App } from '@iskra-bun/core';
import type { OracleConfig } from '../src/config';
import { OracleDriver } from '../src/driver';
import type { OracleConnectionLike, OraclePoolLike, OracleRawResult } from '../src/types';

// A stand-in for node-oracledb's pool and connections: records every call and
// answers statements through `respond`. The real oracledb module still loads
// (for its constants); nothing connects to a database.

export interface Call {
    sql: string;
    binds: unknown;
    options: Record<string, unknown>;
    connection: FakeConnection;
}

export type Responder = (call: Call) => OracleRawResult | Error | Promise<OracleRawResult | Error>;

/** An Error shaped like node-oracledb's for an ORA code. */
export function oraError(errorNum: number, message: string): Error {
    const code = `ORA-${String(errorNum).padStart(5, '0')}`;
    return Object.assign(new Error(`${code}: ${message}`), { errorNum, code });
}

export class FakeConnection implements OracleConnectionLike {
    commits = 0;
    rollbacks = 0;
    closed = 0;

    constructor(private readonly pool: FakePool) {}

    async execute(sql: string, binds: unknown, options: Record<string, unknown>): Promise<OracleRawResult> {
        const call = { sql, binds, options, connection: this };
        this.pool.calls.push(call);
        const result = await this.pool.respond(call);
        if (result instanceof Error) throw result;
        return result;
    }

    async executeMany(sql: string, binds: unknown[], options: Record<string, unknown>) {
        return this.execute(sql, binds, options);
    }

    async commit() {
        this.commits++;
    }

    async rollback() {
        this.rollbacks++;
    }

    async close() {
        this.closed++;
    }
}

export class FakePool implements OraclePoolLike {
    calls: Call[] = [];
    connections: FakeConnection[] = [];
    closedWith: number | undefined;
    respond: Responder = () => ({ rows: [] });

    async getConnection() {
        const connection = new FakeConnection(this);
        this.connections.push(connection);
        return connection;
    }

    async close(drainTime?: number) {
        this.closedWith = drainTime;
    }

    /** The statements run, without the `SELECT 1 FROM DUAL` of start(). */
    get statements(): string[] {
        return this.calls.map((c) => c.sql).filter((sql) => sql !== 'SELECT 1 FROM DUAL');
    }
}

export class TestDriver<DB = Record<string, never>> extends OracleDriver<DB> {
    readonly fake = new FakePool();
    poolAttributes: Record<string, unknown> | undefined;
    standalone: FakeConnection[] = [];

    protected override async createPool(attributes: Record<string, unknown>) {
        this.poolAttributes = attributes;
        return this.fake;
    }

    protected override async connect() {
        const connection = await this.fake.getConnection();
        this.standalone.push(connection);
        return connection;
    }
}

export const CONFIG = { connectString: 'db:1521/FREEPDB1', user: 'app', password: 'secret' };

/** An app with `oracle` as its config section; null for none. */
export function makeApp(oracle: unknown = CONFIG) {
    return new App({
        name: 'OracleTest',
        logger: { level: 'silent' },
        ...(oracle === null ? {} : { oracle: oracle as OracleConfig }),
    });
}

/** A TestDriver initialized and started on an app with `oracle` config. */
export async function startedDriver<DB = Record<string, never>>(oracle: unknown = CONFIG) {
    const driver = new TestDriver<DB>();
    const app = makeApp(oracle);
    await driver.init(app);
    await driver.start();
    return { driver, app, pool: driver.fake };
}
