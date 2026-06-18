import type { Driver, App } from '@iskra-bun/core';
import { spawn, type Subprocess } from 'bun';
import { resolve } from 'path';

export class OracleDriver implements Driver {
    name = 'db'; // Replaces standard db driver if used, or can be 'oracle'
    private proc: Subprocess | null = null;
    private reqId = 0;
    private pending = new Map<number, { resolve: (val: any) => void, reject: (err: any) => void }>();
    private bridgePath: string;

    constructor(bridgePath?: string) {
        // Allow overriding path for flexibility (absolute path)
        // Defaults to calculating relative to this file in a built package structure
        // Adjust logic if needed based on where this file ends up (dist vs src)
        // For dev (src), it's ../bridge/runner.js
        this.bridgePath = bridgePath || resolve(import.meta.dir, '../bridge/runner.js');
    }

    async init(app: App) {
        // If we want to replace the main 'db' object or sit alongside it
        app.context.set('oracle', this);
    }

    async start(app?: App) { // app optional to satisfy interface but we might need config from it
        // Check env vars
        if (!process.env.ORA_CONN) {
            console.warn('Oracle connection string (ORA_CONN) not set. Oracle driver will not start.');
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

    async query(sql: string, params: any[] = []) {
        if (!this.proc || !this.proc.stdin) {
            throw new Error('Oracle driver not started');
        }

        const id = this.reqId++;

        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });

            const msg = JSON.stringify({ id, sql, params }) + '\n';
            const stdin = this.proc!.stdin as any; // Bun FileSink/writer
            if (stdin.write) {
                stdin.write(msg);
                stdin.flush();
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
                    if (!line.trim()) continue;
                    try {
                        const msg = JSON.parse(line);

                        if (msg.type === 'ready') {
                            // console.log('Oracle Bridge Ready');
                            continue;
                        }
                        if (msg.type === 'fatal') {
                            console.error('Oracle Bridge Fatal Error:', msg.error);
                            // Reject all pending?
                            continue;
                        }

                        if (msg.id !== undefined && this.pending.has(msg.id)) {
                            const { resolve, reject } = this.pending.get(msg.id)!;
                            this.pending.delete(msg.id);

                            if (msg.error) {
                                reject(new Error(msg.error));
                            } else {
                                resolve(msg.data);
                            }
                        }
                    } catch (err) {
                        console.error('Error parsing bridge message:', err, line);
                    }
                }
            }
        } catch (err) {
            console.error('Error reading from Oracle bridge:', err);
        } finally {
            reader.releaseLock();
        }
    }
}
