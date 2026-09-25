import type { Driver, App } from '@iskra-bun/core';
import { Queue, QueueEvents, UnrecoverableError, Worker, type Job as BullJob } from 'bullmq';
import { QueueError, JobError } from './errors';
import type {
    WorkerManagerOptions,
    JobOptions,
    JobHandler,
    RepeatSpec,
    JobDescriptor,
    DeadLetterPayload,
} from './types';

export type {
    WorkerManagerOptions,
    JobOptions,
    JobHandler,
    RepeatSpec,
    JobDescriptor,
    DeadLetterPayload,
} from './types';
export * from './errors';

export class WorkerManager implements Driver {
    name = 'WorkerManager';
    private app: App | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private handlers: Map<string, JobHandler<any, any>> = new Map();
    private queue: Queue | null = null;
    private worker: Worker | null = null;
    private queueEvents: QueueEvents | null = null;
    private stopped = false;
    private options: WorkerManagerOptions;

    /** Tope de tamaño (bytes) del payload serializado de un job. */
    private static readonly MAX_PAYLOAD_BYTES = 1024 * 1024; // 1 MB

    constructor(options: WorkerManagerOptions) {
        this.options = options;
    }

    async init(app: App) {
        this.app = app;

        const connection = this.parseConnection();

        try {
            this.queue = new Queue(this.options.queueName || 'iskra-jobs', {
                connection,
                defaultJobOptions: this.mapJobOptions(this.options.defaultJobOptions),
            });
        } catch (err) {
            throw new QueueError('Failed to initialize BullMQ queue', {
                cause: err instanceof Error ? err : new Error(String(err)),
                context: { queueName: this.options.queueName || 'iskra-jobs' },
            });
        }
        // Without an 'error' listener BullMQ prints connection errors to the
        // console; route them through the app logger instead.
        this.queue.on('error', (err) => this.logConnectionError('queue', err));
    }

    /**
     * Registra un handler para un tipo de job. El handler puede devolver un
     * valor `R` que queda disponible como resultado del job.
     */
    register<T = unknown, R = void>(jobName: string, handler: JobHandler<T, R>) {
        this.handlers.set(jobName, handler);
        return this;
    }

    /**
     * Encola un job para ser procesado. Devuelve un descriptor que, además de
     * los datos del job, expone `result()` para esperar el valor de retorno del
     * handler.
     */
    async enqueue<T = unknown, R = unknown>(name: string, data: T, opts?: JobOptions): Promise<JobDescriptor<T, R>> {
        if (!this.queue) {
            throw new QueueError('Queue not initialized. Did you call init()?', {
                context: { jobName: name },
            });
        }

        this.validateEnqueue(name, data, opts);

        const job = await this.queue.add(name, data, this.mapJobOptions(opts));
        this.app?.logger.debug({ jobId: job.id, jobName: name }, 'Job enqueued');
        return this.buildDescriptor<T, R>(job, name, data);
    }

    /**
     * Programa un job repetible (cron o intervalo). Conveniencia sobre
     * `enqueue` con la opción `repeat` ya configurada.
     *
     * @param repeat patrón cron (string) o `{ every: ms }`/`{ pattern: cron }`.
     */
    async schedule<T = unknown, R = unknown>(
        name: string,
        data: T,
        repeat: RepeatSpec,
        opts?: JobOptions,
    ): Promise<JobDescriptor<T, R>> {
        return this.enqueue<T, R>(name, data, { ...opts, repeat });
    }

    /**
     * `consume: false`, or `concurrency: 0` (which used to fall back to 1, so
     * a service meant to only enqueue consumed jobs it had no handler for).
     */
    private get producerOnly(): boolean {
        return this.options.consume === false || this.options.concurrency === 0;
    }

    async start() {
        if (this.producerOnly) {
            this.app?.logger.info(
                { queue: this.options.queueName || 'iskra-jobs' },
                'WorkerManager started in producer-only mode (consume: false / concurrency: 0)',
            );
            return;
        }

        const connection = this.parseConnection();

        this.worker = new Worker(
            this.options.queueName || 'iskra-jobs',
            async (job: BullJob) => {
                const handler = this.handlers.get(job.name);
                if (!handler) {
                    // Returning would mark the job completed and silently drop
                    // it. Fail it permanently instead (no retries), so it stays
                    // in the failed set and reaches dead-letter handling.
                    this.app?.logger.error({ jobName: job.name, jobId: job.id }, 'No handler registered for job');
                    throw new UnrecoverableError(`No handler registered for job "${job.name}"`);
                }

                try {
                    return await handler({
                        id: job.id!,
                        name: job.name,
                        data: job.data,
                        attemptsMade: job.attemptsMade,
                    });
                } catch (err) {
                    const jobErr = new JobError(`Job "${job.name}" failed`, {
                        cause: err instanceof Error ? err : new Error(String(err)),
                        context: { jobId: job.id, jobName: job.name, attemptsMade: job.attemptsMade },
                    });
                    this.app?.logger.error({ err: jobErr }, jobErr.message);
                    throw err; // Re-throw para que BullMQ maneje el retry
                }
            },
            {
                connection,
                concurrency: this.options.concurrency || 1,
            },
        );

        this.worker.on('completed', (job) => {
            this.app?.logger.debug({ jobId: job.id, jobName: job.name }, 'Job completed');
        });

        this.worker.on('failed', (job, err) => {
            this.onFailed(job, err);
        });

        this.worker.on('error', (err) => this.logConnectionError('worker', err));

        this.app?.logger.info(
            {
                queue: this.options.queueName || 'iskra-jobs',
                concurrency: this.options.concurrency || 1,
            },
            'WorkerManager started',
        );
    }

    async stop() {
        // Mark as stopped first so any in-flight result()/getQueueEvents() call
        // throws instead of lazily opening a fresh, never-closed QueueEvents.
        this.stopped = true;

        // Close the worker first (without force) so BullMQ waits for any
        // in-flight job to finish before tearing down its Redis connections.
        // Only then close the queue — closing them concurrently can cut the
        // queue connection out from under a still-draining worker.
        if (this.worker) {
            try {
                await this.worker.close();
            } catch (err) {
                this.app?.logger.error(
                    { err: err instanceof Error ? err : new Error(String(err)) },
                    'WorkerManager: error while closing worker',
                );
            }
        }

        if (this.queueEvents) {
            try {
                await this.queueEvents.close();
            } catch (err) {
                this.app?.logger.error(
                    { err: err instanceof Error ? err : new Error(String(err)) },
                    'WorkerManager: error while closing queue events',
                );
            }
        }

        if (this.queue) {
            try {
                await this.queue.close();
            } catch (err) {
                this.app?.logger.error(
                    { err: err instanceof Error ? err : new Error(String(err)) },
                    'WorkerManager: error while closing queue',
                );
            }
        }

        this.app?.logger.info('WorkerManager stopped');
    }

    private logConnectionError(source: string, err: Error) {
        this.app?.logger.error({ err, source }, 'WorkerManager: BullMQ connection error');
    }

    /**
     * Turns a redis:// or rediss:// URL into ioredis options, keeping the ACL
     * username, the percent-decoded password, the db index and TLS (rediss).
     */
    private parseConnection() {
        if (typeof this.options.connection === 'string') {
            const url = new URL(this.options.connection);
            return {
                // URL keeps the brackets of an IPv6 host ("[::1]"); ioredis wants the bare address.
                host: url.hostname.replace(/^\[(.*)\]$/, '$1'),
                port: Number(url.port) || 6379,
                username: url.username ? decodeURIComponent(url.username) : undefined,
                password: url.password ? decodeURIComponent(url.password) : undefined,
                db: url.pathname ? Number(url.pathname.slice(1)) || 0 : 0,
                ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
            };
        }
        return this.options.connection;
    }

    /**
     * Only the options that were given: BullMQ merges `{ ...defaultJobOptions,
     * ...opts }`, so an explicit `undefined` erased the queue default (a job
     * enqueued with just `{ priority }`, and every scheduled job, lost its
     * attempts, backoff and removeOn* settings).
     */
    private mapJobOptions(opts?: JobOptions) {
        if (!opts) return undefined;
        const mapped: Record<string, unknown> = {};
        for (const key of ['attempts', 'delay', 'priority', 'backoff', 'removeOnComplete', 'removeOnFail'] as const) {
            if (opts[key] !== undefined) mapped[key] = opts[key];
        }
        if (opts.repeat !== undefined) {
            mapped.repeat = this.mapRepeat(opts.repeat);
        }
        return mapped;
    }

    /**
     * Normaliza una RepeatSpec a la forma `repeat` de BullMQ:
     * - string  → `{ pattern: cron }`
     * - `{ every }` / `{ pattern }` → se reenvían tal cual.
     */
    private mapRepeat(repeat: RepeatSpec) {
        if (typeof repeat === 'string') {
            return { pattern: repeat };
        }
        return { ...repeat };
    }

    /**
     * Valida la entrada de `enqueue` ANTES de tocar Redis, para evitar que
     * entrada no confiable inunde la queue, almacene payloads gigantes o
     * programe repeticiones malformadas. Lanza `QueueError` ante cualquier
     * problema; no muta nada.
     */
    private validateEnqueue(name: string, data: unknown, opts?: JobOptions) {
        // A consuming instance only accepts jobs it can process itself; a
        // producer-only instance (consume: false) enqueues for other workers.
        if (!this.producerOnly && !this.handlers.has(name)) {
            throw new QueueError(`No handler registered for job "${name}"`, {
                context: { jobName: name },
            });
        }

        this.validatePayloadSize(name, data);

        if (opts?.repeat !== undefined) {
            this.validateRepeat(name, opts.repeat);
        }
    }

    /** Rechaza payloads cuya serialización JSON excede el tope configurado. */
    private validatePayloadSize(name: string, data: unknown) {
        let serialized: string;
        try {
            serialized = JSON.stringify(data ?? null);
        } catch (err) {
            throw new QueueError(`Job "${name}" data is not serializable`, {
                cause: err instanceof Error ? err : new Error(String(err)),
                context: { jobName: name },
            });
        }

        const size = Buffer.byteLength(serialized, 'utf8');
        if (size > WorkerManager.MAX_PAYLOAD_BYTES) {
            throw new QueueError(
                `Job "${name}" payload too large: ${size} bytes (max ${WorkerManager.MAX_PAYLOAD_BYTES})`,
                { context: { jobName: name, size, max: WorkerManager.MAX_PAYLOAD_BYTES } },
            );
        }
    }

    /** Rechaza specs de repetición vacías, intervalos no positivos o crons en blanco. */
    private validateRepeat(name: string, repeat: RepeatSpec) {
        if (typeof repeat === 'string') {
            if (repeat.trim().length === 0) {
                throw new QueueError(`Job "${name}" has an empty cron repeat pattern`, {
                    context: { jobName: name },
                });
            }
            return;
        }

        const hasEvery = 'every' in repeat;
        const hasPattern = 'pattern' in repeat;
        if (!hasEvery && !hasPattern) {
            throw new QueueError(`Job "${name}" repeat spec must define "every" or "pattern"`, {
                context: { jobName: name },
            });
        }

        if (hasEvery && !(typeof repeat.every === 'number' && repeat.every > 0)) {
            throw new QueueError(`Job "${name}" repeat "every" must be a positive number`, {
                context: { jobName: name, every: repeat.every },
            });
        }

        if (hasPattern && (typeof repeat.pattern !== 'string' || repeat.pattern.trim().length === 0)) {
            throw new QueueError(`Job "${name}" repeat "pattern" must be a non-empty cron string`, {
                context: { jobName: name },
            });
        }
    }

    /**
     * Maneja el evento `failed` del worker. Loggea el fallo y, si el job agotó
     * todos sus reintentos y `deadLetter` está activado, emite
     * `worker:dead-letter` en el bus de eventos de la App.
     */
    private onFailed(job: BullJob | undefined, err: Error) {
        this.app?.logger.error({ jobId: job?.id, jobName: job?.name, err }, 'Job failed');

        if (!this.options.deadLetter || !job) return;

        // BullMQ default attempts is 1 when unspecified.
        //
        // Assumed BullMQ `attemptsMade` semantics at the `failed` event: on a
        // job's TERMINAL failure (all retries exhausted) BullMQ reports
        // `attemptsMade == opts.attempts`, so `attemptsMade < maxAttempts`
        // identifies a non-terminal failure with a retry still pending. This is
        // verified against bullmq 5.78 (see test/dead-letter-attempts*.test.ts);
        // a future bump that changes `attemptsMade` reporting will fail those
        // tests loudly rather than silently skip dead-lettering.
        const maxAttempts = job.opts?.attempts ?? 1;
        // An UnrecoverableError (e.g. no handler) is terminal regardless of attempts left.
        if (job.attemptsMade < maxAttempts && err?.name !== 'UnrecoverableError') return;

        const payload: DeadLetterPayload = {
            jobId: job.id,
            name: job.name,
            data: job.data,
            failedReason: job.failedReason ?? err?.message,
            attemptsMade: job.attemptsMade,
        };
        this.app?.events.emit('worker:dead-letter', payload);
        this.app?.logger.warn(
            { jobId: job.id, jobName: job.name, attemptsMade: job.attemptsMade },
            'Job routed to dead-letter',
        );
    }

    /**
     * Construye el descriptor de un job, incluyendo el helper `result()` que
     * espera el valor de retorno del handler vía `job.waitUntilFinished`.
     */
    private buildDescriptor<T, R>(job: BullJob, name: string, data: T): JobDescriptor<T, R> {
        return {
            id: job.id!,
            name,
            data,
            // async so a post-stop getQueueEvents() throw surfaces as a rejected
            // promise rather than a synchronous throw.
            result: async (ttlMs?: number): Promise<R> => {
                const queueEvents = this.getQueueEvents();
                return job.waitUntilFinished(queueEvents, ttlMs) as Promise<R>;
            },
        };
    }

    /**
     * Devuelve (creando perezosamente) una instancia compartida de QueueEvents
     * usada para esperar resultados de jobs.
     */
    private getQueueEvents(): QueueEvents {
        if (this.stopped) {
            throw new QueueError('WorkerManager is stopped; cannot open QueueEvents', {
                context: { queueName: this.options.queueName || 'iskra-jobs' },
            });
        }
        if (!this.queueEvents) {
            try {
                this.queueEvents = new QueueEvents(this.options.queueName || 'iskra-jobs', {
                    connection: this.parseConnection(),
                });
            } catch (err) {
                throw new QueueError('Failed to initialize BullMQ QueueEvents', {
                    cause: err instanceof Error ? err : new Error(String(err)),
                    context: { queueName: this.options.queueName || 'iskra-jobs' },
                });
            }
        }
        return this.queueEvents;
    }
}
