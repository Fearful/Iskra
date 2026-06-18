import type { Driver, App } from '@iskra-bun/core';
import { Queue, Worker, type Job as BullJob } from 'bullmq';
import { QueueError, JobError } from './errors';
import type { WorkerManagerOptions, JobOptions, JobHandler } from './types';

export type { WorkerManagerOptions, JobOptions, JobHandler } from './types';
export * from './errors';

export class WorkerManager implements Driver {
    name = 'WorkerManager';
    private app: App | null = null;
    private handlers: Map<string, JobHandler> = new Map();
    private queue: Queue | null = null;
    private worker: Worker | null = null;
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
     * Registra un handler para un tipo de job.
     */
    register(jobName: string, handler: JobHandler) {
        this.handlers.set(jobName, handler);
        return this;
    }

    /**
     * Encola un job para ser procesado.
     */
    async enqueue(name: string, data: any, opts?: JobOptions) {
        if (!this.queue) {
            throw new QueueError('Queue not initialized. Did you call init()?', {
                context: { jobName: name },
            });
        }

        const job = await this.queue.add(name, data, this.mapJobOptions(opts));
        this.app?.logger.debug({ jobId: job.id, jobName: name }, 'Job enqueued');
        return { id: job.id!, name, data };
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
                    await handler({
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
            this.app?.logger.error({ jobId: job?.id, jobName: job?.name, err }, 'Job failed');
        });

        this.app?.logger.info({
            queue: this.options.queueName || 'iskra-jobs',
            concurrency: this.options.concurrency || 1,
        }, 'WorkerManager started');
    }

    async stop() {
        const closePromises: Promise<void>[] = [];

        if (this.worker) {
            closePromises.push(this.worker.close());
        }
        if (this.queue) {
            closePromises.push(this.queue.close());
        }

        await Promise.all(closePromises);
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
        return {
            attempts: opts.attempts,
            delay: opts.delay,
            priority: opts.priority,
            backoff: opts.backoff,
            removeOnComplete: opts.removeOnComplete,
            removeOnFail: opts.removeOnFail,
        };
    }
}
