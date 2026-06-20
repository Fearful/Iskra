import type { Driver, App } from '@iskra-bun/core';
import { Queue, QueueEvents, Worker, type Job as BullJob } from 'bullmq';
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
    private options: WorkerManagerOptions;

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
    async enqueue<T = unknown, R = unknown>(
        name: string,
        data: T,
        opts?: JobOptions,
    ): Promise<JobDescriptor<T, R>> {
        if (!this.queue) {
            throw new QueueError('Queue not initialized. Did you call init()?', {
                context: { jobName: name },
            });
        }

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

    async start() {
        const connection = this.parseConnection();

        this.worker = new Worker(
            this.options.queueName || 'iskra-jobs',
            async (job: BullJob) => {
                const handler = this.handlers.get(job.name);
                if (!handler) {
                    this.app?.logger.warn({ jobName: job.name, jobId: job.id }, 'No handler registered for job');
                    return;
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

        this.app?.logger.info({
            queue: this.options.queueName || 'iskra-jobs',
            concurrency: this.options.concurrency || 1,
        }, 'WorkerManager started');
    }

    async stop() {
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

    private parseConnection() {
        if (typeof this.options.connection === 'string') {
            const url = new URL(this.options.connection);
            return {
                host: url.hostname,
                port: Number(url.port) || 6379,
                password: url.password || undefined,
                db: url.pathname ? Number(url.pathname.slice(1)) || 0 : 0,
            };
        }
        return this.options.connection;
    }

    private mapJobOptions(opts?: JobOptions) {
        if (!opts) return undefined;
        const mapped: Record<string, unknown> = {
            attempts: opts.attempts,
            delay: opts.delay,
            priority: opts.priority,
            backoff: opts.backoff,
            removeOnComplete: opts.removeOnComplete,
            removeOnFail: opts.removeOnFail,
        };
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
     * Maneja el evento `failed` del worker. Loggea el fallo y, si el job agotó
     * todos sus reintentos y `deadLetter` está activado, emite
     * `worker:dead-letter` en el bus de eventos de la App.
     */
    private onFailed(job: BullJob | undefined, err: Error) {
        this.app?.logger.error({ jobId: job?.id, jobName: job?.name, err }, 'Job failed');

        if (!this.options.deadLetter || !job) return;

        // BullMQ default attempts is 1 when unspecified.
        const maxAttempts = job.opts?.attempts ?? 1;
        if (job.attemptsMade < maxAttempts) return;

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
            result: (ttlMs?: number): Promise<R> => {
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
