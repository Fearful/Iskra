import type { Driver, App } from '@iskra-bun/core';
import { spawn, type Subprocess, type FileSink } from 'bun';
import { existsSync } from 'fs';
import { resolve } from 'path';

type PendingEntry = {
    resolve: (val: unknown) => void;
    reject: (err: unknown) => void;
    timer: ReturnType<typeof setTimeout> | null;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_START_TIMEOUT_MS = 30_000;

/** Settles once when the bridge reports `ready`, a fatal error, or exits. */
type ReadyWaiter = { resolve: () => void; reject: (err: Error) => void };

export class OracleDriver implements Driver {
    name = 'OracleDriver';
    private proc: Subprocess | null = null;
    private reqId = 0;
    // Replaced on every start(): each bridge process owns its own pending map,
    // so the reader of a previous (stopped) bridge can never reject queries
    // sent to the new one.
    private pending = new Map<number, PendingEntry>();
    private bridgePath: string;
    private timeoutMs: number;
    private startTimeoutMs: number;
    private app: App | null = null;

    /**
     * @param bridgePath Path to the bridge script; defaults to the `bridge/runner.js`
     *   shipped with this package (it is resolved next to both `src/` and `dist/`).
     * @param timeoutMs Per-query timeout.
     * @param startTimeoutMs How long start() waits for the bridge to connect.
     */
    constructor(
        bridgePath?: string,
        timeoutMs: number = DEFAULT_TIMEOUT_MS,
        startTimeoutMs: number = DEFAULT_START_TIMEOUT_MS,
    ) {
        this.bridgePath = bridgePath || resolve(import.meta.dir, '../bridge/runner.js');
        this.timeoutMs = timeoutMs;
        this.startTimeoutMs = startTimeoutMs;
    }

    async init(app: App) {
        this.app = app;
        // If we want to replace the main 'db' object or sit alongside it
        app.context.set('oracle', this);
    }

    async start(app?: App) {
        // app optional to satisfy interface but we might need config from it
        if (app) this.app = app;

        // Check env vars
        if (!process.env.ORA_CONN) {
            this.log('warn', 'Oracle connection string (ORA_CONN) not set. Oracle driver will not start.');
            return;
        }

        if (!existsSync(this.bridgePath)) {
            throw new Error(`Oracle bridge script not found at ${this.bridgePath}`);
        }

        const pending = new Map<number, PendingEntry>();
        this.pending = pending;
        const proc = spawn(['node', this.bridgePath], {
            stdin: 'pipe',
            stdout: 'pipe',
            env: { ...process.env },
        });

        if (!proc.stdout) {
            proc.kill();
            throw new Error('Failed to spawn Oracle bridge process (no stdout)');
        }

        // start() only resolves once the bridge has connected to Oracle, so a
        // bad connect string or missing oracledb fails the app's start instead
        // of surfacing later as failed queries.
        let waiter!: ReadyWaiter;
        const ready = new Promise<void>((res, rej) => {
            let settled = false;
            waiter = {
                resolve: () => {
                    if (!settled) {
                        settled = true;
                        res();
                    }
                },
                reject: (err) => {
                    if (!settled) {
                        settled = true;
                        rej(err);
                    }
                },
            };
        });
        this.readStream(proc.stdout as ReadableStream, pending, waiter);

        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                ready,
                new Promise<never>((_, rej) => {
                    timer = setTimeout(
                        () => rej(new Error(`Oracle bridge did not become ready within ${this.startTimeoutMs}ms`)),
                        this.startTimeoutMs,
                    );
                }),
            ]);
        } catch (err) {
            proc.kill();
            throw err;
        } finally {
            clearTimeout(timer);
        }
        this.proc = proc;
    }

    async stop() {
        if (this.proc) {
            const proc = this.proc;
            this.proc = null;
            // Closing stdin lets the bridge close its Oracle connection and exit;
            // kill it if it has not exited shortly after.
            try {
                (proc.stdin as FileSink).end();
            } catch {
                // already closed
            }
            const exited = proc.exited
                ? await Promise.race([proc.exited.then(() => true), Bun.sleep(2000).then(() => false)])
                : false;
            if (!exited) proc.kill();
        }
    }

    private log(level: 'error' | 'warn', objOrMsg: unknown, msg?: string) {
        // Route all diagnostics through app.logger; never use the global console.
        if (!this.app) return;
        const logger = this.app.logger;
        if (typeof objOrMsg === 'string') {
            logger[level](objOrMsg);
        } else {
            logger[level](objOrMsg as object, msg);
        }
    }

    private settle(pending: Map<number, PendingEntry>, id: number, action: (entry: PendingEntry) => void) {
        const entry = pending.get(id);
        if (!entry) return;
        if (entry.timer) clearTimeout(entry.timer);
        pending.delete(id);
        action(entry);
    }

    private rejectAllPending(err: Error, pending: Map<number, PendingEntry>) {
        for (const id of Array.from(pending.keys())) {
            this.settle(pending, id, ({ reject }) => reject(err));
        }
    }

    async query(sql: string, params: unknown[] = []) {
        if (!this.proc || !this.proc.stdin) {
            throw new Error('Oracle driver not started');
        }

        const id = this.reqId++;
        const pending = this.pending;

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.settle(pending, id, ({ reject: rej }) =>
                    rej(new Error(`Oracle query timed out after ${this.timeoutMs}ms`)),
                );
            }, this.timeoutMs);

            pending.set(id, { resolve, reject, timer });

            const msg = JSON.stringify({ id, sql, params }) + '\n';
            const stdin = this.proc!.stdin as FileSink;
            if (typeof stdin.write === 'function') {
                stdin.write(msg);
                stdin.flush();
            } else {
                // No writable stdin: do not leave the request hanging in pending.
                this.settle(pending, id, ({ reject: rej }) => rej(new Error('Oracle bridge stdin is not writable')));
            }
        });
    }

    private async readStream(stream: ReadableStream, pending: Map<number, PendingEntry>, waiter: ReadyWaiter) {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // Keep incomplete line

                for (const line of lines) {
                    this.handleLine(line, pending, waiter);
                }
            }
        } catch (err) {
            this.log('error', { err }, 'Error reading from Oracle bridge');
            this.rejectAllPending(new Error('Oracle bridge stream error'), pending);
        } finally {
            reader.releaseLock();
            waiter.reject(new Error('Oracle bridge process exited before it was ready'));
            this.rejectAllPending(new Error('Oracle bridge process exited'), pending);
        }
    }

    private handleLine(line: string, pending: Map<number, PendingEntry>, waiter: ReadyWaiter) {
        if (!line.trim()) return;
        try {
            const msg = JSON.parse(line);

            if (msg.type === 'ready') {
                waiter.resolve();
                return;
            }
            if (msg.type === 'fatal') {
                this.log('error', { error: msg.error }, 'Oracle Bridge Fatal Error');
                waiter.reject(new Error(`Oracle bridge fatal: ${msg.error}`));
                this.rejectAllPending(new Error(`Oracle bridge fatal: ${msg.error}`), pending);
                return;
            }

            if (msg.id !== undefined) {
                this.settle(pending, msg.id, ({ resolve, reject }) => {
                    if (msg.error) {
                        reject(new Error(msg.error));
                    } else {
                        resolve(msg.data);
                    }
                });
            }
        } catch (err) {
            this.log('error', { err, line }, 'Error parsing bridge message');
        }
    }
}
