import type { App, Driver, ProcessConfig } from '@iskra-bun/core';
import type { FileSink } from 'bun';
import { Subprocess } from 'bun';
import { readdirSync, readFileSync } from 'node:fs';

interface RunningProcess {
    process: Subprocess;
    config: ProcessConfig;
    name: string;
    restarts: number;
    startedAt: number;
    /** Current computed backoff delay in ms (grows with each crash) */
    currentBackoffMs: number;
    /** Bytes send() queued for stdin that have not reached the pipe yet. */
    pendingStdinBytes?: number;
    /** send() refused a message since pendingStdinBytes was last 0. */
    stdinFull?: boolean;
}

/** Longest stdout/stderr line kept in memory before it is emitted truncated. */
const MAX_LINE_LENGTH = 1024 * 1024;
/** How often terminate() re-checks whether the process group is gone. */
const GROUP_POLL_MS = 25;
/** Default ProcessConfig.maxPendingStdinBytes. */
const MAX_PENDING_STDIN_BYTES = 8 * 1024 * 1024;

/**
 * What a child inherits from the app's environment unless `inheritEnv` says
 * otherwise: what programs need to run, and no secrets. NODE_ENV too, or a
 * Node/Bun child would silently run in development mode.
 */
const BASE_ENV = [
    'PATH',
    'HOME',
    'USER',
    'LOGNAME',
    'SHELL',
    'TERM',
    'LANG',
    'LANGUAGE',
    'TZ',
    'TMPDIR',
    'TMP',
    'TEMP',
    'NODE_ENV',
    // Windows: many programs (Python's sockets, say) fail to start without these.
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'PATHEXT',
    'USERPROFILE',
];

/**
 * The environment a child starts with. It used to be all of process.env, so
 * every child got every secret the app has (DATABASE_URL, AUTH_SECRET, cloud
 * keys, whatever c12 loaded from .env), third-party code included.
 */
function childEnv(config: ProcessConfig): Record<string, string | undefined> {
    const inherit = config.inheritEnv ?? false;
    if (inherit === true) return { ...process.env, ...config.env };
    // Names are case-insensitive on Windows (Path, SystemRoot).
    const key = (name: string) => (process.platform === 'win32' ? name.toUpperCase() : name);
    const names = new Set([...BASE_ENV, ...(inherit === false ? [] : inherit)].map(key));
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(process.env)) {
        if (value !== undefined && (names.has(key(name)) || name.startsWith('LC_'))) env[name] = value;
    }
    return { ...env, ...config.env };
}

/**
 * Whether any live (non-zombie) process is left in process group `pgid`. On
 * Linux /proc is read, because a signal-0 probe also succeeds for zombies,
 * which a container's PID 1 may never reap; elsewhere the probe is used.
 */
function groupAlive(pgid: number | undefined): boolean {
    if (!pgid || process.platform === 'win32') return false;
    try {
        process.kill(-pgid, 0);
    } catch {
        return false; // no process at all in the group
    }
    if (process.platform === 'linux') {
        try {
            for (const entry of readdirSync('/proc')) {
                if (!/^\d+$/.test(entry)) continue;
                let stat: string;
                try {
                    stat = readFileSync(`/proc/${entry}/stat`, 'utf8');
                } catch {
                    continue; // exited while scanning
                }
                // "pid (comm) state ppid pgrp ...": comm may contain spaces/parens.
                const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
                if (Number(fields[2]) === pgid && fields[0] !== 'Z' && fields[0] !== 'X') return true;
            }
            return false;
        } catch {
            // no /proc: trust the probe
        }
    }
    return true;
}

/** Whether an exit (null code when killed by a signal) counts as a crash. */
function crashedExit(exitCode: number | null, signal: string | null): boolean {
    return signal !== null || exitCode !== 0;
}

export class ProcessManager implements Driver {
    name = 'ProcessManager';
    private app: App | null = null;
    private processes: Map<string, RunningProcess> = new Map();
    /** Restarts waiting out their backoff delay, so kill()/stop() can cancel them. */
    private restartTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
    /** Crashed instances whose leftover children are still being terminated, by name. */
    private reaping: Map<string, Promise<void>> = new Map();
    private stopping = false;
    /**
     * Process groups this manager started that may still have members,
     * including ones being terminated (no longer in `processes`).
     */
    private liveGroups = new Set<number>();
    /** SIGKILLs every tracked group when the parent exits; see trackGroup(). */
    private readonly killGroupsOnExit = () => {
        for (const pgid of this.liveGroups) {
            try {
                process.kill(-pgid, 'SIGKILL');
            } catch {
                Bun.spawnSync(['kill', '-KILL', '--', `-${pgid}`], { stdout: 'ignore', stderr: 'ignore' });
            }
        }
        this.liveGroups.clear();
    };

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
            try {
                this.spawnProcess(name, config);
            } catch (err) {
                // A process that cannot be spawned (missing binary, say) does
                // not fail the app: it is reported, and retried if supervised.
                this.spawnFailed(name, err, {
                    config,
                    name,
                    restarts: 0,
                    startedAt: Date.now(),
                    currentBackoffMs: config.restartBackoff?.initialMs ?? 1000,
                });
            }
        }
    }

    /**
     * Spawn and register a new process at runtime. Reuses the existing internal
     * spawn logic and respects the process mode (stdio/daemon/oneshot).
     *
     * @throws {Error} if a process with the given name is already registered,
     *   or if it cannot be spawned (e.g. the command does not exist).
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
     * Send SIGTERM to the process group, escalate to SIGKILL after
     * `gracefulTimeoutMs`, and wait up to another `gracefulTimeoutMs` for the
     * group to be gone. The whole group counts, not just the direct child: a
     * wrapper that exits on SIGTERM used to leave a grandchild that ignores it
     * running for good. A group still alive after that is reported as an
     * orphan via `app.logger.error`.
     */
    private async terminate(name: string, proc: Subprocess, gracefulTimeoutMs: number): Promise<void> {
        let exited = proc.exitCode != null || proc.signalCode != null;
        proc.exited.then(
            () => {
                exited = true;
            },
            () => {
                exited = true;
            },
        );
        const pid = (proc as { pid?: number }).pid;
        const gone = () => exited && !groupAlive(pid);

        this.sendSignal(proc, 'SIGTERM');
        if (await this.waitUntil(gone, gracefulTimeoutMs)) return this.untrackGroup(pid);

        this.app?.logger.warn(`Process ${name} did not exit within ${gracefulTimeoutMs}ms; sending SIGKILL`);
        this.sendSignal(proc);
        if (await this.waitUntil(gone, gracefulTimeoutMs)) return this.untrackGroup(pid);

        this.app?.logger.error(
            { name },
            `Process ${name} survived SIGTERM and SIGKILL and is now an orphan; manual cleanup may be required`,
        );
    }

    /** Polls `condition` until it holds or `timeoutMs` passes; leaves no timer behind. */
    private async waitUntil(condition: () => boolean, timeoutMs: number): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;
        while (!condition()) {
            if (Date.now() >= deadline) return false;
            await Bun.sleep(Math.min(GROUP_POLL_MS, Math.max(0, deadline - Date.now())));
        }
        return true;
    }

    /**
     * After a crash, terminates what is left of the dead instance's process
     * group (children of a wrapper that died), so a restart does not run next
     * to them (holding the same port, say) and they are not leaked.
     */
    private reapGroup(name: string, proc: Subprocess, gracefulTimeoutMs = 5000) {
        const pid = (proc as { pid?: number }).pid;
        if (!groupAlive(pid)) return this.untrackGroup(pid);
        this.app?.logger.warn(`Process ${name} crashed and left children behind; terminating them`);
        // A restart waits for this (see scheduleRestart), so the new instance
        // never runs next to the old one's children.
        const done: Promise<void> = this.terminate(`${name} (leftover children)`, proc, gracefulTimeoutMs).finally(
            () => {
                if (this.reaping.get(name) === done) this.reaping.delete(name);
            },
        );
        this.reaping.set(name, done);
    }

    private async readStdOut(name: string, stream: ReadableStream) {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        // Set once a line outgrew MAX_LINE_LENGTH: the rest of it, up to the
        // next newline, is dropped. It used to be read as a line of its own,
        // so text a child echoed (`user said: <1 MiB of spaces>{"type":…}`)
        // came out as a JSON process:message.
        let skippingRestOfLine = false;

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                const lines = buffer.split('\n');
                // Keep the last chunk if it's not a complete line (doesn't end with \n)
                buffer = lines.pop() || '';
                if (skippingRestOfLine && lines.length > 0) {
                    lines.shift();
                    skippingRestOfLine = false;
                }

                for (const line of lines) {
                    if (!line.trim()) continue;
                    this.processLine(name, line);
                }

                // A child that never prints a newline must not grow this forever.
                if (buffer.length > MAX_LINE_LENGTH) {
                    // Truncated: a log line, never parsed as a message.
                    if (!skippingRestOfLine) this.app?.emit('process:log', { name, text: buffer });
                    buffer = '';
                    skippingRestOfLine = true;
                }
            }
            // The last line may lack a trailing newline; it used to be dropped.
            buffer += decoder.decode();
            if (!skippingRestOfLine && buffer.trim()) this.processLine(name, buffer);
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
    private computeBackoffMs(procInfo: Omit<RunningProcess, 'process'>): number {
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
        // A clean exit that left nothing behind needs no cleanup on exit.
        if (!crashedExit(exitCode, signal)) {
            const pid = (procInfo.process as { pid?: number }).pid;
            if (!groupAlive(pid)) this.untrackGroup(pid);
        }

        const how = signal ? `signal ${signal}` : `code ${exitCode}`;
        const crashed = crashedExit(exitCode, signal);
        if (crashed) this.app?.logger.warn(`Process ${name} exited with ${how}`);
        else this.app?.logger.info(`Process ${name} exited with ${how}`);

        // Remove from map so we don't try to kill it again on stop()
        this.processes.delete(name);
        this.app?.emit('process:exit', { name, exitCode, signal });
        if (crashed) this.reapGroup(name, procInfo.process);

        // oneshot processes run to completion once and are never restarted
        if (procInfo.config.mode === 'oneshot') {
            return;
        }

        // A clean exit (code 0) is intentional, not a crash.
        if (procInfo.config.restartOnCrash && crashed) {
            this.scheduleRestart(name, procInfo);
        }
    }

    /** Schedules the next restart of a crashed process (or of one that failed to spawn). */
    private scheduleRestart(name: string, procInfo: Omit<RunningProcess, 'process'>) {
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

        const fire = () => {
            // The crashed instance's children are still being terminated:
            // check again shortly. The timer stays registered, so kill(),
            // stop() and spawn()'s duplicate check still see the restart.
            if (this.reaping.has(name)) {
                this.restartTimers.set(name, setTimeout(fire, GROUP_POLL_MS));
                return;
            }
            this.restartTimers.delete(name);
            try {
                this.spawnProcess(name, procInfo.config, restarts, delayMs);
            } catch (err) {
                // e.g. the binary is briefly missing mid-deploy: a failed
                // respawn counts as a crash instead of ending supervision.
                this.spawnFailed(name, err, {
                    ...procInfo,
                    restarts,
                    startedAt: Date.now(),
                    currentBackoffMs: delayMs,
                });
            }
        };
        this.restartTimers.set(name, setTimeout(fire, delayMs));
    }

    /** Reports a process that could not be spawned; a supervised one is retried. */
    private spawnFailed(name: string, error: unknown, procInfo: Omit<RunningProcess, 'process'>) {
        this.app?.emit('process:spawn-error', { name, error });
        if (procInfo.config.restartOnCrash && procInfo.config.mode !== 'oneshot') {
            this.scheduleRestart(name, procInfo);
        }
    }

    // Updated spawn signature to track restarts and backoff state
    private spawnProcess(name: string, config: ProcessConfig, restarts = 0, currentBackoffMs?: number) {
        if (this.stopping || !this.app) return;

        const initialBackoffMs = config.restartBackoff?.initialMs ?? 1000;

        // Arguments only at debug: they can carry credentials (`--db-url
        // postgres://user:password@…`), which no key-based redaction sees.
        this.app.logger.info(`Spawning process: ${name} (${config.command}, ${config.args?.length ?? 0} args)`);
        this.app.logger.debug({ name, command: config.command, args: config.args ?? [] }, `Process ${name} arguments`);

        try {
            const proc = Bun.spawn([config.command, ...(config.args || [])], {
                env: childEnv(config),
                stdout: config.mode === 'stdio' ? 'pipe' : 'inherit',
                stderr: config.mode === 'stdio' ? 'pipe' : 'inherit',
                stdin: config.mode === 'stdio' ? 'pipe' : 'ignore',
                // Own process group, so stop()/kill() can signal the whole tree.
                detached: process.platform !== 'win32',
                onExit: (exitedProc, exitCode) => {
                    this.handleExit(name, exitCode, exitedProc.signalCode ?? null, exitedProc);
                },
            });

            this.trackGroup(proc.pid);
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
            // spawn() rejects with it; start() and restarts report and retry.
            throw err;
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

    /**
     * Children run in their own process group, so neither the terminal's
     * Ctrl-C nor the parent's death reaches them. When the app exits before
     * stop() has finished with them (the App's shutdownTimeoutMs or a second
     * signal call process.exit), the 'exit' listener SIGKILLs every group
     * still tracked: 'exit' listeners run synchronously on process.exit().
     */
    private trackGroup(pgid: number | undefined) {
        if (!pgid || process.platform === 'win32') return;
        if (this.liveGroups.size === 0) process.on('exit', this.killGroupsOnExit);
        this.liveGroups.add(pgid);
    }

    private untrackGroup(pgid: number | undefined) {
        if (!pgid || !this.liveGroups.delete(pgid)) return;
        if (this.liveGroups.size === 0) process.off('exit', this.killGroupsOnExit);
    }

    /**
     * Writes `data` to a `stdio` process's stdin as one line: an object is
     * JSON-encoded, a string is written as is. Resolves to false, with a
     * warning, when the message is not sent: no such process, not in stdio
     * mode, a string with a line break, or a child that has not read what it
     * was sent (see ProcessConfig.maxPendingStdinBytes).
     */
    async send(name: string, data: unknown): Promise<boolean> {
        const procInfo = this.processes.get(name);
        if (!procInfo) {
            this.app?.logger.warn(`Cannot send message to non-existent process: ${name}`);
            return false;
        }

        if (procInfo.config.mode !== 'stdio' || !procInfo.process.stdin) {
            this.app?.logger.warn(`Cannot send message to process ${name} (mode is not stdio or stdin is closed)`);
            return false;
        }

        // Bun's Subprocess.stdin is a FileSink when stdin is piped.
        const stdin = procInfo.process.stdin as FileSink;

        // One message per line: a string with a line break would reach the
        // child as several messages (`'alice\n{"cmd":"delete_all"}'`).
        if (typeof data === 'string' && /[\r\n]/.test(data)) {
            this.app?.logger.warn(
                `Not sending a string with a line break to process ${name}: send an object to have it JSON-encoded`,
            );
            return false;
        }

        try {
            // If data is object, stringify it and add newline
            const message = (typeof data === 'string' ? data : JSON.stringify(data)) + '\n';
            // What the pipe does not take waits in this process's memory: 256
            // MiB sent to a child that never reads its stdin grew RSS by 263
            // MiB. One message is still accepted when nothing is waiting.
            const size = Buffer.byteLength(message);
            const pending = procInfo.pendingStdinBytes ?? 0;
            const max = procInfo.config.maxPendingStdinBytes ?? MAX_PENDING_STDIN_BYTES;
            if (pending > 0 && pending + size > max) {
                // One warning until the child catches up, not one per message.
                if (!procInfo.stdinFull) {
                    this.app?.logger.warn(
                        `Not sending to process ${name}: ${pending} bytes sent to it are still waiting to be read (maxPendingStdinBytes: ${max})`,
                    );
                }
                procInfo.stdinFull = true;
                return false;
            }
            // On a pipe, write()/flush() can return promises that reject with
            // EPIPE once the child is gone: unhandled, they crashed the app.
            const onError = (err: unknown) => this.app?.logger.error({ err }, `Failed to write to process ${name}`);
            const written: unknown = stdin.write(message);
            if (written instanceof Promise) written.catch(onError);
            // flush is optional on the FileSink surface — call it only if present.
            const flushed: unknown = typeof stdin.flush === 'function' ? stdin.flush() : undefined;
            if (flushed instanceof Promise) flushed.catch(onError);
            // A promise means Bun kept bytes the pipe did not take; it settles
            // once they are written (or the child is gone).
            const drained = [written, flushed].find((r): r is Promise<unknown> => r instanceof Promise);
            if (drained) {
                procInfo.pendingStdinBytes = pending + size;
                const release = () => {
                    procInfo.pendingStdinBytes = (procInfo.pendingStdinBytes ?? size) - size;
                    if (procInfo.pendingStdinBytes <= 0) procInfo.stdinFull = false;
                };
                drained.then(release, release);
            }
            return true;
        } catch (err) {
            this.app?.logger.error({ err }, `Failed to write to process ${name}`);
            return false;
        }
    }

    async stop(gracefulTimeoutMs = 5000) {
        this.stopping = true;
        this.app?.logger.info('Stopping all processes...');

        for (const timer of this.restartTimers.values()) clearTimeout(timer);
        this.restartTimers.clear();
        this.reaping.clear();

        const entries = [...this.processes.entries()];
        this.processes.clear();

        await Promise.all(
            entries.map(async ([name, info]) => {
                const proc = info.process;
                if (proc.killed) return;
                await this.terminate(name, proc, gracefulTimeoutMs);
            }),
        );
    }
}

// Events a ProcessManager emits on the app (see the README).
declare module '@iskra-bun/core' {
    interface AppEvents {
        /** A stdio child printed a line that parses as JSON. */
        'process:message': { name: string; message: unknown };
        /** A stdio child printed a line that is not JSON. */
        'process:log': { name: string; text: string };
        /** A line a stdio child wrote to stderr. */
        'process:error': { name: string; text: string };
        /** A child exited on its own (not after kill()/stop()); exitCode is null when a signal ended it. */
        'process:exit': { name: string; exitCode: number | null; signal: string | null };
        'process:max-restarts': { name: string; restarts: number; maxRestarts: number };
        /** The command could not be spawned (a supervised process is retried). */
        'process:spawn-error': { name: string; error: unknown };
    }
}
