import type { App, Driver, ProcessConfig } from '@iskra-bun/core';
import { Subprocess } from 'bun';

interface RunningProcess {
    process: Subprocess;
    config: ProcessConfig;
    name: string;
    restarts: number;
    startedAt: number;
    /** Current computed backoff delay in ms (grows with each crash) */
    currentBackoffMs: number;
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

    /**
     * Spawn and register a new process at runtime. Reuses the existing internal
     * spawn logic and respects the process mode (stdio/daemon/oneshot).
     *
     * @throws {Error} if a process with the given name is already registered.
     */
    async spawn(name: string, config: ProcessConfig): Promise<void> {
        if (this.processes.has(name)) {
            throw new Error(`Process '${name}' is already registered. Kill it first or use a different name.`);
        }
        this.spawnProcess(name, config);
    }

    /**
     * Gracefully stop and remove a single named process. Sends SIGTERM and
     * escalates to SIGKILL after gracefulTimeoutMs if the process has not exited.
     *
     * @throws {Error} if no process with the given name exists.
     */
    async kill(name: string, gracefulTimeoutMs = 5000): Promise<void> {
        const procInfo = this.processes.get(name);
        if (!procInfo) {
            throw new Error(`Process '${name}' not found. It may have already exited or never been spawned.`);
        }

        // Remove from the map before terminating so handleExit won't try to restart it
        this.processes.delete(name);

        const proc = procInfo.process;
        if (proc.killed) return;

        proc.kill('SIGTERM');

        const deadline = gracefulTimeoutMs * 2;
        const forceKillTimer = setTimeout(() => {
            if (!proc.killed) {
                this.app?.logger.warn(`Process ${name} did not exit within ${gracefulTimeoutMs}ms; sending SIGKILL`);
                proc.kill();
            }
        }, gracefulTimeoutMs);

        try {
            await Promise.race([
                proc.exited,
                new Promise<void>(r => setTimeout(r, deadline)),
            ]);
        } finally {
            clearTimeout(forceKillTimer);
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

    /**
     * Compute the next backoff delay for a process restart.
     *
     * - If no `restartBackoff` config is provided, returns the flat 1000 ms default.
     * - Otherwise applies exponential growth: `min(currentMs * factor, maxMs)`.
     * - If the process was stable (uptime > restartCooldown), the backoff resets to initialMs.
     */
    private computeBackoffMs(procInfo: RunningProcess): number {
        const backoffCfg = procInfo.config.restartBackoff;
        if (!backoffCfg) {
            return 1000;
        }

        const cooldown = procInfo.config.restartCooldown ?? 60000;
        const uptime = Date.now() - procInfo.startedAt;
        if (uptime > cooldown) {
            // Process was stable — reset to initial delay
            return backoffCfg.initialMs;
        }

        const next = Math.min(procInfo.currentBackoffMs * backoffCfg.factor, backoffCfg.maxMs);
        return next;
    }

    private handleExit(name: string, exitCode: number, signalCode: number) {
        if (this.stopping) return;

        const procInfo = this.processes.get(name);
        if (!procInfo) return;

        this.app?.logger.warn(`Process ${name} exited with code ${exitCode}`);

        // Remove from map so we don't try to kill it again on stop()
        this.processes.delete(name);

        // oneshot processes run to completion once and are never restarted
        if (procInfo.config.mode === 'oneshot') {
            this.app?.emit('process:exit', { name, exitCode });
            return;
        }

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

            const delayMs = this.computeBackoffMs(procInfo);

            this.app?.logger.info(`Restarting process: ${name} (Attempt ${restarts}/${maxRestarts}) in ${delayMs}ms`);

            setTimeout(() => {
                this.spawnProcess(name, procInfo.config, restarts, delayMs);
            }, delayMs);
        }
    }

    // Updated spawn signature to track restarts and backoff state
    private spawnProcess(name: string, config: ProcessConfig, restarts = 0, currentBackoffMs?: number) {
        if (this.stopping || !this.app) return;

        const initialBackoffMs = config.restartBackoff?.initialMs ?? 1000;

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
                currentBackoffMs: currentBackoffMs ?? initialBackoffMs,
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

    async stop(gracefulTimeoutMs = 5000) {
        this.stopping = true;
        this.app?.logger.info('Stopping all processes...');

        const entries = [...this.processes.entries()];
        this.processes.clear();

        await Promise.all(
            entries.map(async ([name, info]) => {
                const proc = info.process;
                if (proc.killed) return;

                // Send SIGTERM and give the process a chance to flush and exit cleanly
                proc.kill('SIGTERM');

                // Hard deadline: SIGKILL after gracefulTimeoutMs, then wait up to
                // the same window again before giving up (guards against Bun exited quirks)
                const deadline = gracefulTimeoutMs * 2;
                const forceKillTimer = setTimeout(() => {
                    if (!proc.killed) {
                        this.app?.logger.warn(`Process ${name} did not exit within ${gracefulTimeoutMs}ms; sending SIGKILL`);
                        proc.kill();
                    }
                }, gracefulTimeoutMs);

                try {
                    await Promise.race([
                        proc.exited,
                        new Promise<void>(r => setTimeout(r, deadline)),
                    ]);
                } finally {
                    clearTimeout(forceKillTimer);
                }
            })
        );
    }
}
