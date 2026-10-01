/** What a handler gets about its run, shaped like worker-kit's jobs. */
export interface ScheduledJob<T = unknown> {
    /** `<name>:<run number>`. */
    id: string;
    name: string;
    data: T;
    /** Always 0: a failed run is not retried, the next one comes on schedule. */
    attemptsMade: number;
}

export interface JobContext {
    /**
     * Aborted when the run exceeds its `timeoutMs` and when the scheduler
     * stops: pass it to fetch() and the database calls so they stop too.
     */
    signal: AbortSignal;
}

/**
 * A job's handler. What it returns is kept as the last run's result
 * (`status(name).lastRun.result`).
 */
export type JobHandler<T = unknown, R = void> = (job: ScheduledJob<T>, context: JobContext) => Promise<R>;

/** How often a job runs: every `every` ms, `limit` times at most. */
export interface IntervalSpec {
    every: number;
    limit?: number;
}

export interface ScheduleOptions {
    /** Run once when the scheduler starts (right away if it already did), then every `every` ms. Default false. */
    runOnStart?: boolean;
    /**
     * How long a run may take, in ms, before its signal is aborted. Default
     * `every`. A handler that ignores the signal keeps running: the job shows
     * as `stuck` and its next runs are skipped until it returns.
     */
    timeoutMs?: number;
}

/** What `schedule()` returns: like worker-kit's job descriptor, without `result()`. */
export interface ScheduledJobDescriptor<T = unknown> {
    id: string;
    name: string;
    data: T;
}

/**
 * What IntervalScheduler and worker-kit's WorkerManager have in common, so
 * an app written against it moves between them by changing the constructor:
 *
 * ```ts
 * const jobs: JobScheduler = new IntervalScheduler();
 * // later, with Redis: new WorkerManager({ connection: process.env.REDIS_URL! })
 * jobs.register('sync', async (job, { signal }) => { … });
 * await jobs.schedule('sync', {}, { every: 180_000 });
 * ```
 */
export interface JobScheduler {
    register<T = unknown, R = void>(name: string, handler: JobHandler<T, R>): this;
    schedule<T = unknown>(name: string, data: T, repeat: IntervalSpec): Promise<ScheduledJobDescriptor<T>>;
}

export interface IntervalSchedulerOptions {
    /** The driver's name in the App's logs. Default `'IntervalScheduler'`. */
    name?: string;
    /**
     * How long `stop()` waits for the runs in progress after aborting their
     * signals, in ms (default 5000). Keep it under the App's
     * `shutdownTimeoutMs` (10 000 by default), which also covers the other drivers.
     */
    shutdownTimeoutMs?: number;
}

/** A job's state, for logs and health checks. */
export interface JobStatus {
    name: string;
    every: number;
    /** Whether a run is in progress. */
    running: boolean;
    /** The run in progress outlived its timeout: its signal is aborted but the handler has not returned. */
    stuck: boolean;
    /** Runs started. */
    runs: number;
    /** Runs that threw. */
    failures: number;
    /** Runs that threw since the last one that did not. */
    consecutiveFailures: number;
    /** Runs skipped because the previous one was still in progress. */
    skipped: number;
    lastRun?: {
        startedAt: Date;
        finishedAt: Date;
        durationMs: number;
        ok: boolean;
        /** What the handler returned, when it did not throw. */
        result?: unknown;
    };
    lastSuccessAt?: Date;
    /** The last error, kept until a later run fails again. Its message stays out of health checks. */
    lastError?: { at: Date; name: string; message: string; code?: string };
    /** When the next run is due; undefined before start() and after stop() or the last run. */
    nextRunAt?: Date;
}

export interface JobHealthOptions {
    /** Consecutive failed runs that make the check fail. Default 3. */
    maxConsecutiveFailures?: number;
    /**
     * The check fails when the last successful run is older than this, in ms
     * (or none succeeded this long after start). Default: not checked.
     */
    maxStalenessMs?: number;
    /** Put the last run's result in the check's details. Default false: it may hold data. */
    includeResult?: boolean;
}

/** The result of a health check, as web-kit's HealthCheckFeature takes it in `checks`. */
export interface JobHealth {
    status: 'ok' | 'error';
    message?: string;
    details: Record<string, unknown>;
}
