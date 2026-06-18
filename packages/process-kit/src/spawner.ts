import type { App, Driver, ProcessConfig } from '@iskra-bun/core';
import { Subprocess } from 'bun';

interface RunningProcess {
    process: Subprocess;
    config: ProcessConfig;
    name: string;
    restarts: number;
    startedAt: number;
}

export class ProcessManager implements Driver {
    name = 'ProcessManager';
    private app: App | null = null;
    private processes: Map<string, RunningProcess> = new Map();
    private stopping = false;

    init(app: App) {
        this.app = app;
    }

    async start() {
        if (!this.app) return;
        const processConfigs = this.app.config.processes;

        if (!processConfigs) {
            this.app.logger.debug('No processes configured.');
            return;
        }

        this.app.logger.info(`Starting ${Object.keys(processConfigs).length} processes...`);

        for (const [name, config] of Object.entries(processConfigs)) {
            this.spawnProcess(name, config);
        }
    }

    private async readStdOut(name: string, stream: ReadableStream) {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                const lines = buffer.split('\n');
                // Keep the last chunk if it's not a complete line (doesn't end with \n)
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    this.processLine(name, line);
                }
            }
        } catch (err) {
            // Stream closed or error
        }
    }

    private processLine(name: string, line: string) {
        try {
            // Try to parse as JSON Event
            const json = JSON.parse(line);
            this.app?.emit('process:message', { name, message: json });
        } catch {
            // Fallback to raw log
            this.app?.emit('process:log', { name, text: line });
        }
    }

    private handleExit(name: string, exitCode: number, signalCode: number) {
        if (this.stopping) return;

        const procInfo = this.processes.get(name);
        if (!procInfo) return;

        this.app?.logger.warn(`Process ${name} exited with code ${exitCode}`);

        // Remove from map so we don't try to kill it again on stop()
        this.processes.delete(name);

        if (procInfo.config.restartOnCrash) {
            const maxRestarts = procInfo.config.maxRestarts ?? 10;
            const cooldown = procInfo.config.restartCooldown ?? 60000;
            const uptime = Date.now() - procInfo.startedAt;

            // If the process ran longer than the cooldown, consider it stable and reset the counter
            const restarts = uptime > cooldown ? 1 : procInfo.restarts + 1;

            if (restarts > maxRestarts) {
                this.app?.logger.error(`Process ${name} exceeded max restarts (${maxRestarts}). Not restarting.`);
                this.app?.emit('process:max-restarts', { name, restarts: procInfo.restarts, maxRestarts });
                return;
            }

            this.app?.logger.info(`Restarting process: ${name} (Attempt ${restarts}/${maxRestarts})`);

            setTimeout(() => {
                this.spawnProcess(name, procInfo.config, restarts);
            }, 1000);
        }
    }

    // Updated spawn signature to track restarts
    private spawnProcess(name: string, config: ProcessConfig, restarts = 0) {
        if (this.stopping || !this.app) return;

        this.app.logger.info(`Spawning process: ${name} (${config.command} ${config.args?.join(' ') || ''})`);

        try {
            const proc = Bun.spawn(
                [config.command, ...(config.args || [])],
                {
                    env: { ...process.env, ...config.env },
                    stdout: config.mode === 'stdio' ? 'pipe' : 'inherit',
                    stderr: config.mode === 'stdio' ? 'pipe' : 'inherit',
                    stdin: config.mode === 'stdio' ? 'pipe' : 'ignore',
                    onExit: (proc, exitCode, signalCode, error) => {
                        this.handleExit(name, exitCode || 0, signalCode || 0);
                    }
                }
            );

            this.processes.set(name, {
                process: proc,
                config,
                name,
                restarts,
                startedAt: Date.now(),
            });

            if (config.mode === 'stdio') {
                if (proc.stdout) this.readStdOut(name, proc.stdout);
                if (proc.stderr) this.readStdErr(name, proc.stderr);
            }

        } catch (err) {
            this.app.logger.error({ err }, `Failed to spawn process: ${name}`);
        }
    }

    private async readStdErr(name: string, stream: ReadableStream) {
        const reader = stream.getReader();
        const decoder = new TextDecoder();

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const text = decoder.decode(value, { stream: true });
                if (text.trim()) {
                    this.app?.emit('process:error', { name, text });
                }
            }
        } catch (err) {
            // Stream closed
        }
    }

    // Send data to process stdin
    async send(name: string, data: any) {
        const procInfo = this.processes.get(name);
        if (!procInfo) {
            this.app?.logger.warn(`Cannot send message to non-existent process: ${name}`);
            return;
        }

        if (procInfo.config.mode !== 'stdio' || !procInfo.process.stdin) {
            this.app?.logger.warn(`Cannot send message to process ${name} (mode is not stdio or stdin is closed)`);
            return;
        }

        // Bun's Subprocess.stdin is a FileSink
        const stdin = procInfo.process.stdin as any;

        try {
            // If data is object, stringify it and add newline
            const message = typeof data === 'string' ? data : JSON.stringify(data);
            stdin.write(message + '\n');
            stdin.flush();
        } catch (err) {
            this.app?.logger.error({ err }, `Failed to write to process ${name}`);
        }
    }

    async stop() {
        this.stopping = true;
        this.app?.logger.info('Stopping all processes...');

        for (const [name, info] of this.processes) {
            if (!info.process.killed) {
                info.process.kill();
            }
        }
        this.processes.clear();
    }
}
