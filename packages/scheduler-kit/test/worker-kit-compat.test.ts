import { describe, expect, it } from 'bun:test';
import { WorkerManager } from '@iskra-bun/worker-kit';
import { IntervalScheduler, type JobHandler, type JobScheduler } from '../src';

// The promise of JobScheduler: the same handler and schedule() call work with
// both, so moving to the Redis-backed queue means changing the constructor.
// Mostly a compile-time check (the root typecheck covers tests); no Redis needed.

const sync: JobHandler<{ board: string }, number> = async (job, { signal }) => {
    if (signal.aborted) return 0;
    return job.data.board.length;
};

async function wire(jobs: JobScheduler) {
    jobs.register('sync', sync);
    return jobs;
}

describe('JobScheduler', () => {
    it('is implemented by IntervalScheduler and by worker-kit WorkerManager', async () => {
        const inProcess: JobScheduler = await wire(new IntervalScheduler());
        const queued: JobScheduler = await wire(new WorkerManager({ connection: 'redis://localhost:6379' }));
        expect(inProcess).toBeInstanceOf(IntervalScheduler);
        expect(queued).toBeInstanceOf(WorkerManager);

        const descriptor = await inProcess.schedule('sync', { board: 'b1' }, { every: 60_000 });
        expect(descriptor.data.board).toBe('b1');
    });
});
