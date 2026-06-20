import type { Driver, App } from '@iskra-bun/core';
import { spawn, type Subprocess, type FileSink } from 'bun';
import { resolve } from 'path';

type PendingEntry = {
    resolve: (val: any) => void;
    reject: (err: any) => void;
    timer: ReturnType<typeof setTimeout> | null;
};

const DEFAULT_TIMEOUT_MS = 30_000;

export class OracleDriver implements Driver {
    name = 'db'; // Replaces standard db driver if used, or can be 'oracle'
    private proc: Subprocess | null = null;
    private reqId = 0;
    private pending = new Map<number, PendingEntry>();
    private bridgePath: string;
    private timeoutMs: number;
    private app: App | null = null;

    constructor(bridgePath?: string, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
        // Allow overriding path for flexibility (absolute path)
        // Defaults to calculating relative to this file in a built package structure
        // Adjust logic if needed based on where this file ends up (dist vs src)
        // For dev (src), it's ../bridge/runner.js
        this.bridgePath = bridgePath || resolve(import.meta.dir, '../bridge/runner.js');
        this.timeoutMs = timeoutMs;
    }

    async init(app: App) {
        this.app = app;
        // If we want to replace the main 'db' object or sit alongside it
        app.context.set('oracle', this);
    }

    async start(app?: App) { // app optional to satisfy interface but we might need config from it
        if (app) this.app = app;

        // Check env vars
        if (!process.env.ORA_CONN) {
            this.log('warn', 'Oracle connection string (ORA_CONN) not set. Oracle driver will not start.');
            return;
        }

        this.proc = spawn(['node', this.bridgePath], {
            stdin: 'pipe',
            stdout: 'pipe',
            env: { ...process.env },
        });

        if (!this.proc.stdout) {
            throw new Error('Failed to spawn Oracle bridge process (no stdout)');
        }

        this.readStream(this.proc.stdout as ReadableStream);

        // Wait for ready signal?
        // For now we assume optimistic start or we could wait for 'ready' message
    }

    async stop() {
        if (this.proc) {
            this.proc.kill();
            this.proc = null;
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

    private settle(id: number, action: (entry: PendingEntry) => void) {
        const entry = this.pending.get(id);
        if (!entry) return;
        if (entry.timer) clearTimeout(entry.timer);
        this.pending.delete(id);
        action(entry);
    }

    private rejectAllPending(err: Error) {
        if (this.pending.size === 0) return;
        const ids = Array.from(this.pending.keys());
        for (const id of ids) {
            this.settle(id, ({ reject }) => reject(err));
        }
    }

    async query(sql: string, params: any[] = []) {
        if (!this.proc || !this.proc.stdin) {
            throw new Error('Oracle driver not started');
        }

        const id = this.reqId++;

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.settle(id, ({ reject: rej }) =>
                    rej(new Error(`Oracle query timed out after ${this.timeoutMs}ms`)),
                );
            }, this.timeoutMs);

            this.pending.set(id, { resolve, reject, timer });

            const msg = JSON.stringify({ id, sql, params }) + '\n';
            const stdin = this.proc!.stdin as FileSink;
            if (typeof stdin.write === 'function') {
                stdin.write(msg);
                stdin.flush();
            } else {
                // No writable stdin: do not leave the request hanging in pending.
                this.settle(id, ({ reject: rej }) =>
                    rej(new Error('Oracle bridge stdin is not writable')),
                );
            }
        });
    }

    private async readStream(stream: ReadableStream) {
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
                    this.handleLine(line);
                }
            }
        } catch (err) {
            this.log('error', { err }, 'Error reading from Oracle bridge');
            this.rejectAllPending(new Error('Oracle bridge stream error'));
        } finally {
            reader.releaseLock();
            this.rejectAllPending(new Error('Oracle bridge process exited'));
        }
    }

    private handleLine(line: string) {
        if (!line.trim()) return;
        try {
            const msg = JSON.parse(line);

            if (msg.type === 'ready') {
                return;
            }
            if (msg.type === 'fatal') {
                this.log('error', { error: msg.error }, 'Oracle Bridge Fatal Error');
                this.rejectAllPending(new Error(`Oracle bridge fatal: ${msg.error}`));
                return;
            }

            if (msg.id !== undefined && this.pending.has(msg.id)) {
                this.settle(msg.id, ({ resolve, reject }) => {
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
