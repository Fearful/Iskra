import type { App, Driver, ProcessConfig } from '@iskra-bun/core';
import type { FileSink } from 'bun';
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

/** Longest stdout/stderr line kept in memory before it is emitted truncated. */
const MAX_LINE_LENGTH = 1024 * 1024;

export class ProcessManager implements Driver {
    name = 'ProcessManager';
    private app: App | null = null;
    private processes: Map<string, RunningProcess> = new Map();
    /** Restarts waiting out their backoff delay, so kill()/stop() can cancel them. */
    private restartTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
    private stopping = false;

    init(app: App) {
        this.app = app;
    }

    async start() {
        if (!this.app) return;
        // A manager that was stopped can be started again.
        this.stopping = false;
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
        if (this.processes.has(name) || this.restartTimers.has(name)) {
            throw new Error(`Process '${name}' is already registered. Kill it first or use a different name.`);
        }
        this.spawnProcess(name, config);
    }

    /**
     * Gracefully stop and remove a single named process. Sends SIGTERM, then
     * escalates to SIGKILL after `gracefulTimeoutMs`. The worst-case wait before
     * this method resolves is `gracefulTimeoutMs * 2`: `gracefulTimeoutMs` for the
     * SIGKILL escalation plus another `gracefulTimeoutMs` grace window for the
     * process to actually exit afterwards. If the process still has not exited by
     * then, it is reported as an orphan via `app.logger.error`.
     *
     * @throws {Error} if no process with the given name exists.
     */
    async kill(name: string, gracefulTimeoutMs = 5000): Promise<void> {
        // A crashed process waiting out its restart backoff has no running
        // instance: cancel the pending restart instead of reporting "not found"
        // and letting the timer respawn it afterwards.
        const pendingRestart = this.restartTimers.get(name);
        if (pendingRestart) {
            clearTimeout(pendingRestart);
            this.restartTimers.delete(name);
            if (!this.processes.has(name)) return;
        }

        const procInfo = this.processes.get(name);
        if (!procInfo) {
            throw new Error(`Process '${name}' not found. It may have already exited or never been spawned.`);
        }

        // Remove from the map before terminating so handleExit won't try to restart it
        this.processes.delete(name);

        const proc = procInfo.process;
        if (proc.killed) return;

        await this.terminate(name, proc, gracefulTimeoutMs);
    }

    /**
     * Sends `signal` to the child's whole process group (it is spawned as a
     * group leader), so grandchildren of wrappers such as `sh -c`, `npm run` or
     * a shell script are terminated too instead of being orphaned. Falls back
     * to signalling the direct child when groups are unavailable.
     */
    private sendSignal(proc: Subprocess, signal?: NodeJS.Signals) {
        const pid = (proc as { pid?: number }).pid;
        if (pid && process.platform !== 'win32') {
            try {
                process.kill(-pid, signal ?? 'SIGKILL');
                return;
            } catch {
                // Bun 1.1 rejects negative pids; use the system kill instead.
                const res = Bun.spawnSync(['kill', `-${(signal ?? 'SIGKILL').replace(/^SIG/, '')}`, '--', `-${pid}`], {
                    stdout: 'ignore',
                    stderr: 'ignore',
                });
                if (res.exitCode === 0) return;
            }
        }
        if (signal) proc.kill(signal);
        else proc.kill();
    }

    /**
     * Send SIGTERM, escalate to SIGKILL after `gracefulTimeoutMs`, and wait up to
     * `gracefulTimeoutMs * 2` for the process to exit. After the race settles, if
     * the process is still alive it is surfaced as an orphan via `app.logger.error`
     * so a hung shutdown is observable instead of silently succeeding.
     */
    private async terminate(name: string, proc: Subprocess, gracefulTimeoutMs: number): Promise<void> {
        let exited = false;
        proc.exited.then(() => { exited = true; }, () => { exited = true; });

        this.sendSignal(proc, 'SIGTERM');

        const deadline = gracefulTimeoutMs * 2;
        const forceKillTimer = setTimeout(() => {
            if (!exited) {
                this.app?.logger.warn(`Process ${name} did not exit within ${gracefulTimeoutMs}ms; sending SIGKILL`);
                this.sendSignal(proc);
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

        if (!exited) {
            this.app?.logger.error(
                { name },
                `Process ${name} survived SIGTERM and SIGKILL and is now an orphan; manual cleanup may be required`,
            );
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
                // A child that never prints a newline must not grow this forever.
                if (buffer.length > MAX_LINE_LENGTH) {
                    lines.push(buffer);
                    buffer = '';
                }

                for (const line of lines) {
                    if (!line.trim()) continue;
                    this.processLine(name, line);
                }
            }
            // The last line may lack a trailing newline; it used to be dropped.
            buffer += decoder.decode();
            if (buffer.trim()) this.processLine(name, buffer);
        } catch (err) {
            // A thrown error here is a broken pipe mid-read, distinct from the
            // normal end-of-stream (`done: true`) that exits the loop above.
            this.app?.logger.debug({ err, name }, `stdout reader for process ${name} failed`);
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
     * - The FIRST restart (`restarts === 0`) waits exactly `currentBackoffMs`
     *   (seeded to `initialMs` on spawn); exponential growth begins on the SECOND
     *   restart with `min(currentMs * factor, maxMs)`.
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
            return backoffCfg.initialMs ?? 1000;
        }

        const maxMs = backoffCfg.maxMs ?? 30000;
        const initialMs = backoffCfg.initialMs ?? 1000;

        // The very first restart (no prior restarts and the backoff has not yet
        // grown past its initial value) waits exactly initialMs — exponential
        // growth begins on the SECOND restart.
        if (procInfo.restarts === 0 && procInfo.currentBackoffMs === initialMs) {
            return Math.min(procInfo.currentBackoffMs, maxMs);
        }

        const factor = backoffCfg.factor ?? 2;
        const next = Math.min(procInfo.currentBackoffMs * factor, maxMs);
        return next;
    }

    /**
     * @param exitCode null when the process was killed by a signal.
     * @param proc the instance that exited: a late exit from an older instance
     *   with the same name (after kill()+spawn(), or a restart) must not remove
     *   or restart the current one.
     */
    private handleExit(name: string, exitCode: number | null, signal: string | null = null, proc?: Subprocess) {
        if (this.stopping) return;

        const procInfo = this.processes.get(name);
        if (!procInfo) return;
        if (proc && procInfo.process !== proc) return;

        const how = signal ? `signal ${signal}` : `code ${exitCode}`;
        const crashed = signal !== null || exitCode !== 0;
        if (crashed) this.app?.logger.warn(`Process ${name} exited with ${how}`);
        else this.app?.logger.info(`Process ${name} exited with ${how}`);

        // Remove from map so we don't try to kill it again on stop()
        this.processes.delete(name);
        this.app?.emit('process:exit', { name, exitCode, signal });

        // oneshot processes run to completion once and are never restarted
        if (procInfo.config.mode === 'oneshot') {
            return;
        }

        // A clean exit (code 0) is intentional, not a crash.
        if (procInfo.config.restartOnCrash && crashed) {
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

            const timer = setTimeout(() => {
                this.restartTimers.delete(name);
                this.spawnProcess(name, procInfo.config, restarts, delayMs);
            }, delayMs);
            this.restartTimers.set(name, timer);
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
                    // Own process group, so stop()/kill() can signal the whole tree.
                    detached: process.platform !== 'win32',
                    onExit: (exitedProc, exitCode) => {
                        this.handleExit(name, exitCode, exitedProc.signalCode ?? null, exitedProc);
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

    /** Emits `process:error` once per stderr line (chunks used to be emitted as they arrived). */
    private async readStdErr(name: string, stream: ReadableStream) {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const emit = (text: string) => {
            if (text.trim()) this.app?.emit('process:error', { name, text });
        };

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                if (buffer.length > MAX_LINE_LENGTH) {
                    lines.push(buffer);
                    buffer = '';
                }
                for (const line of lines) emit(line);
            }
            emit(buffer + decoder.decode());
        } catch (err) {
            // A thrown error here is a broken pipe mid-read, distinct from the
            // normal end-of-stream (`done: true`) that exits the loop above.
            this.app?.logger.debug({ err, name }, `stderr reader for process ${name} failed`);
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

        // Bun's Subprocess.stdin is a FileSink when stdin is piped.
        const stdin = procInfo.process.stdin as FileSink;

        try {
            // If data is object, stringify it and add newline
            const message = typeof data === 'string' ? data : JSON.stringify(data);
            stdin.write(message + '\n');
            // flush is optional on the FileSink surface — call it only if present.
            if (typeof stdin.flush === 'function') {
                stdin.flush();
            }
        } catch (err) {
            this.app?.logger.error({ err }, `Failed to write to process ${name}`);
        }
    }

    async stop(gracefulTimeoutMs = 5000) {
        this.stopping = true;
        this.app?.logger.info('Stopping all processes...');

        for (const timer of this.restartTimers.values()) clearTimeout(timer);
        this.restartTimers.clear();

        const entries = [...this.processes.entries()];
        this.processes.clear();

        await Promise.all(
            entries.map(async ([name, info]) => {
                const proc = info.process;
                if (proc.killed) return;
                await this.terminate(name, proc, gracefulTimeoutMs);
            })
        );
    }
}
