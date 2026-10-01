import type { App, Driver } from '@iskra-bun/core';
import type {
    IntervalSchedulerOptions,
    IntervalSpec,
    JobHandler,
    JobHealth,
    JobHealthOptions,
    JobScheduler,
    JobStatus,
    ScheduledJobDescriptor,
    ScheduleOptions,
} from './types';

/** The pino-style logger the App gives its drivers. */
interface Log {
    debug(obj: object, msg: string): void;
    info(obj: object, msg: string): void;
    warn(obj: object, msg: string): void;
    error(obj: object, msg: string): void;
    child?(bindings: Record<string, unknown>): Log;
}

/* eslint-disable no-console -- the fallback before init() gives the App's logger. */
const consoleLog: Log = {
    debug: () => {},
    info: () => {},
    warn: (obj, msg) => console.warn(msg, obj),
    error: (obj, msg) => console.error(msg, obj),
};
/* eslint-enable no-console */

interface Run {
    controller: AbortController;
    startedAt: Date;
    timedOut: boolean;
    done: Promise<void>;
}

interface Job {
    name: string;
    data: unknown;
    every: number;
    limit?: number;
    timeoutMs: number;
    runOnStart: boolean;
    timer?: ReturnType<typeof setInterval>;
    armedAt?: Date;
    nextRunAt?: number;
    run?: Run;
    runs: number;
    failures: number;
    consecutiveFailures: number;
    skipped: number;
    lastRun?: JobStatus['lastRun'];
    lastSuccessAt?: Date;
    lastError?: JobStatus['lastError'];
}

function positiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Runs jobs every N ms in the app's own process, without Redis: a backup
 * sync, a cleanup, a poll. A run that is still going when the next one is
 * due makes that one skip; a run that throws is logged and the schedule
 * goes on; on stop() the runs in progress get their signal aborted and are
 * waited for up to `shutdownTimeoutMs`. `status()` and `healthCheck()` show
 * each job's last run and last error.
 *
 * Its `register()` and `schedule()` are worker-kit's WorkerManager's (see
 * `JobScheduler`), so moving to a Redis-backed queue later means changing
 * the constructor. Each process runs its own schedule: with several
 * instances of the app, every one of them runs the job.
 *
 * Register it after the drivers its jobs use (the web server and its
 * database): the App stops drivers in reverse order, so the jobs end before
 * what they need goes away.
 */
export class IntervalScheduler implements Driver, JobScheduler {
    readonly name: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly handlers = new Map<string, JobHandler<any, any>>();
    private readonly jobs = new Map<string, Job>();
    private readonly shutdownTimeoutMs: number;
    private log: Log = consoleLog;
    private started = false;
    private stopped = false;

    constructor(options: IntervalSchedulerOptions = {}) {
        this.name = options.name ?? 'IntervalScheduler';
        this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5000;
    }

    init(app: App): void {
        const logger = app.logger as unknown as Log;
        this.log = logger.child?.({ driver: this.name }) ?? logger;
    }

    /** Sets the handler of the jobs named `name`. */
    register<T = unknown, R = void>(name: string, handler: JobHandler<T, R>): this {
        this.handlers.set(name, handler);
        return this;
    }

    /**
     * Runs the `name` job with `data` every `repeat.every` ms, once the
     * scheduler starts (right away when it already did). Its handler must be
     * registered first; a name can be scheduled once.
     */
    async schedule<T = unknown>(
        name: string,
        data: T,
        repeat: IntervalSpec,
        options: ScheduleOptions = {},
    ): Promise<ScheduledJobDescriptor<T>> {
        if (this.stopped) throw new Error(`${this.name} is stopped; cannot schedule "${name}"`);
        if (!this.handlers.has(name)) throw new Error(`No handler registered for job "${name}"`);
        if (this.jobs.has(name)) throw new Error(`Job "${name}" is already scheduled`);
        if (typeof repeat !== 'object' || repeat === null || !positiveInteger(repeat.every)) {
            throw new Error(
                `Job "${name}": repeat.every must be a positive integer of ms (only intervals are supported)`,
            );
        }
        if (repeat.limit !== undefined && !positiveInteger(repeat.limit)) {
            throw new Error(`Job "${name}": repeat.limit must be a positive integer`);
        }
        const timeoutMs = options.timeoutMs ?? repeat.every;
        if (!positiveInteger(timeoutMs)) throw new Error(`Job "${name}": timeoutMs must be a positive integer of ms`);

        const job: Job = {
            name,
            data,
            every: repeat.every,
            limit: repeat.limit,
            timeoutMs,
            runOnStart: options.runOnStart ?? false,
            runs: 0,
            failures: 0,
            consecutiveFailures: 0,
            skipped: 0,
        };
        this.jobs.set(name, job);
        if (this.started) this.arm(job);
        return { id: name, name, data };
    }

    start(): void {
        if (this.stopped) throw new Error(`${this.name} cannot start again after stop()`);
        if (this.started) return;
        this.started = true;
        for (const job of this.jobs.values()) this.arm(job);
        this.log.info({ jobs: [...this.jobs.keys()] }, `${this.name} started`);
    }

    /**
     * Stops every schedule, aborts the signal of the runs in progress and
     * waits for them up to `shutdownTimeoutMs`.
     */
    async stop(): Promise<void> {
        this.stopped = true;
        for (const job of this.jobs.values()) this.disarm(job);
        const running = [...this.jobs.values()].filter((job) => job.run);
        if (running.length > 0) {
            for (const job of running) {
                job.run!.controller.abort(new DOMException(`${this.name} is stopping`, 'AbortError'));
            }
            let timer: ReturnType<typeof setTimeout> | undefined;
            const ended = await Promise.race([
                Promise.all(running.map((job) => job.run!.done)).then(() => true),
                new Promise<boolean>((resolve) => {
                    timer = setTimeout(() => resolve(false), this.shutdownTimeoutMs);
                }),
            ]);
            clearTimeout(timer);
            if (!ended) {
                this.log.warn(
                    {
                        jobs: running.filter((job) => job.run).map((job) => job.name),
                        timeoutMs: this.shutdownTimeoutMs,
                    },
                    'Job runs did not end after their signal was aborted; stopping without them',
                );
            }
        }
        this.log.info({}, `${this.name} stopped`);
    }

    /** The state of the `name` job. */
    status(name: string): JobStatus {
        const job = this.jobs.get(name);
        if (!job) throw new Error(`Job "${name}" is not scheduled`);
        return {
            name: job.name,
            every: job.every,
            running: job.run !== undefined,
            stuck: job.run?.timedOut ?? false,
            runs: job.runs,
            failures: job.failures,
            consecutiveFailures: job.consecutiveFailures,
            skipped: job.skipped,
            ...(job.lastRun && { lastRun: { ...job.lastRun } }),
            ...(job.lastSuccessAt && { lastSuccessAt: job.lastSuccessAt }),
            ...(job.lastError && { lastError: { ...job.lastError } }),
            ...(job.nextRunAt !== undefined && { nextRunAt: new Date(job.nextRunAt) }),
        };
    }

    /** The state of every scheduled job. */
    statuses(): JobStatus[] {
        return [...this.jobs.keys()].map((name) => this.status(name));
    }

    /**
     * A check for web-kit's HealthCheckFeature (`checks: { sync:
     * jobs.healthCheck('sync') }`): it fails when the job is not scheduled,
     * when its run in progress is stuck past its timeout, after
     * `maxConsecutiveFailures` failed runs in a row, or when it has not
     * succeeded for `maxStalenessMs`. Its details carry the last run and the
     * last error's name and code; the error's message (it may hold URLs or
     * tokens) stays in the log.
     */
    healthCheck(name: string, options: JobHealthOptions = {}): () => Promise<JobHealth> {
        const maxConsecutiveFailures = options.maxConsecutiveFailures ?? 3;
        return async () => {
            const job = this.jobs.get(name);
            if (!job) return { status: 'error', message: 'not scheduled', details: {} };
            const problems: string[] = [];
            if (job.run?.timedOut) problems.push('stuck past its timeout');
            if (job.consecutiveFailures >= maxConsecutiveFailures) {
                problems.push(`${job.consecutiveFailures} failed runs in a row`);
            }
            const since = job.lastSuccessAt ?? job.armedAt;
            if (
                options.maxStalenessMs !== undefined &&
                since &&
                Date.now() - since.getTime() > options.maxStalenessMs
            ) {
                problems.push(job.lastSuccessAt ? 'no successful run lately' : 'no successful run yet');
            }
            const { lastRun, lastError } = job;
            const details: Record<string, unknown> = {
                running: job.run !== undefined,
                runs: job.runs,
                failures: job.failures,
                consecutiveFailures: job.consecutiveFailures,
                skipped: job.skipped,
                ...(lastRun && {
                    lastRun: {
                        startedAt: lastRun.startedAt.toISOString(),
                        durationMs: lastRun.durationMs,
                        ok: lastRun.ok,
                        ...(options.includeResult && lastRun.ok && { result: lastRun.result }),
                    },
                }),
                ...(job.lastSuccessAt && { lastSuccessAt: job.lastSuccessAt.toISOString() }),
                ...(lastError && {
                    lastError: {
                        at: lastError.at.toISOString(),
                        name: lastError.name,
                        ...(lastError.code && { code: lastError.code }),
                    },
                }),
                ...(job.nextRunAt !== undefined && { nextRunAt: new Date(job.nextRunAt).toISOString() }),
            };
            return problems.length > 0
                ? { status: 'error', message: problems.join('; '), details }
                : { status: 'ok', details };
        };
    }

    private arm(job: Job): void {
        job.armedAt = new Date();
        job.nextRunAt = Date.now() + job.every;
        job.timer = setInterval(() => this.tick(job), job.every);
        if (job.runOnStart) this.tick(job);
    }

    private disarm(job: Job): void {
        if (job.timer) clearInterval(job.timer);
        job.timer = undefined;
        job.nextRunAt = undefined;
    }

    private tick(job: Job): void {
        if (this.stopped) return;
        if (job.timer) job.nextRunAt = Date.now() + job.every;
        if (job.run) {
            job.skipped++;
            this.log.debug({ job: job.name }, 'Job run skipped: the previous one is still in progress');
            return;
        }
        const handler = this.handlers.get(job.name)!;
        job.runs++;
        if (job.limit !== undefined && job.runs >= job.limit) this.disarm(job);

        const controller = new AbortController();
        const run: Run = { controller, startedAt: new Date(), timedOut: false, done: Promise.resolve() };
        const timeout = setTimeout(() => {
            run.timedOut = true;
            this.log.warn({ job: job.name, timeoutMs: job.timeoutMs }, 'Job run timed out; aborting its signal');
            controller.abort(new DOMException(`Job "${job.name}" timed out after ${job.timeoutMs}ms`, 'TimeoutError'));
        }, job.timeoutMs);
        job.run = run;
        run.done = (async () => {
            try {
                const result = await handler(
                    { id: `${job.name}:${job.runs}`, name: job.name, data: job.data, attemptsMade: 0 },
                    { signal: controller.signal },
                );
                this.finish(job, run, true, result);
                job.lastSuccessAt = job.lastRun!.finishedAt;
                job.consecutiveFailures = 0;
            } catch (err) {
                this.finish(job, run, false);
                job.failures++;
                job.consecutiveFailures++;
                const error = err instanceof Error ? err : new Error(String(err));
                const code = (err as { code?: unknown } | null)?.code;
                job.lastError = {
                    at: job.lastRun!.finishedAt,
                    name: error.name,
                    message: error.message,
                    ...(typeof code === 'string' && { code }),
                };
                this.log.error({ err: error, job: job.name }, 'Job run failed');
            } finally {
                clearTimeout(timeout);
                job.run = undefined;
            }
        })();
    }

    private finish(job: Job, run: Run, ok: boolean, result?: unknown): void {
        const finishedAt = new Date();
        job.lastRun = {
            startedAt: run.startedAt,
            finishedAt,
            durationMs: finishedAt.getTime() - run.startedAt.getTime(),
            ok,
            ...(ok && { result }),
        };
    }
}
