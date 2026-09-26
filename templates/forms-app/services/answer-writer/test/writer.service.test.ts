import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { WriterService } from '../src/domain/writer/writer.service';
import { config } from '../src/app.config.ts';

function makeJob(formId = 'form-1') {
    return { formId, data: { name: 'x' }, ipHash: 'hash', recaptchaScore: 0.9 } as any;
}

// A fake Drizzle-ish db: db.insert(table).values(rows) records the inserted
// rows, and rejects the whole call when it contains a row for `badForm`.
function makeFakeDb(badForm?: string) {
    const inserted: any[] = [];
    let calls = 0;
    return {
        inserted,
        get calls() {
            return calls;
        },
        insert() {
            return {
                values: async (rows: any) => {
                    calls++;
                    const list = Array.isArray(rows) ? rows : [rows];
                    if (list.some((r) => r.formId === badForm)) throw new Error('violates foreign key constraint');
                    inserted.push(...list);
                },
            };
        },
    };
}

/** Whether `promise` has settled, after letting pending callbacks run. */
async function settled(promise: Promise<unknown>) {
    let done = false;
    promise.then(
        () => (done = true),
        () => (done = true),
    );
    await Bun.sleep(0);
    return done;
}

describe('WriterService batching', () => {
    let errSpy: ReturnType<typeof spyOn>;
    let logSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
        WriterService.stopFlushTimer();
        (WriterService as any).buffer = [];
        errSpy = spyOn(console, 'error').mockImplementation(() => {});
        logSpy = spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        WriterService.stopFlushTimer();
        errSpy.mockRestore();
        logSpy.mockRestore();
    });

    it('settles a job only once its answer is stored', async () => {
        const db = makeFakeDb();
        WriterService.setDb(db);

        const pending = WriterService.bufferAnswer(makeJob('form-a'));
        // Buffered, not stored: the job must not complete yet (a crash here
        // used to lose answers whose jobs had already completed).
        expect(await settled(pending)).toBe(false);
        expect(db.inserted.length).toBe(0);

        await WriterService.flush();
        await pending;
        expect(db.inserted.length).toBe(1);
        expect(db.inserted[0]).toMatchObject({ formId: 'form-a', ipHash: 'hash', recaptchaScore: 0.9 });
        expect(db.inserted[0].id).toBeDefined();
        expect((WriterService as any).buffer.length).toBe(0);
    });

    it('auto-flushes once the buffer reaches the configured max size', async () => {
        const db = makeFakeDb();
        WriterService.setDb(db);

        const jobs = Array.from({ length: config.batch.maxSize }, () => WriterService.bufferAnswer(makeJob()));
        await Promise.all(jobs);

        expect(db.inserted.length).toBe(config.batch.maxSize);
        expect(db.calls).toBe(1);
        expect((WriterService as any).buffer.length).toBe(0);
    });

    it('flush is a no-op on an empty buffer', async () => {
        const db = makeFakeDb();
        WriterService.setDb(db);
        await WriterService.flush();
        expect(db.calls).toBe(0);
    });

    it('fails only the job of a bad answer; the rest of the batch is stored', async () => {
        // An answer queued before its form was deleted: its FK violation
        // failed the batch, which went back to the buffer and failed forever.
        const db = makeFakeDb('deleted-form');
        WriterService.setDb(db);

        const bad = WriterService.bufferAnswer(makeJob('deleted-form'));
        const good = [WriterService.bufferAnswer(makeJob('live')), WriterService.bufferAnswer(makeJob('live'))];
        await WriterService.flush();

        await expect(bad).rejects.toThrow(/foreign key/);
        await Promise.all(good);
        expect(db.inserted.map((r) => r.formId)).toEqual(['live', 'live']);
        expect((WriterService as any).buffer.length).toBe(0);

        // Later batches are not affected.
        const next = WriterService.bufferAnswer(makeJob('live'));
        await WriterService.flush();
        await next;
        expect(db.inserted.length).toBe(3);
    });

    it('the flush timer flushes a non-empty buffer when it fires', async () => {
        let tick: (() => unknown) | null = null;
        const setIntervalSpy = spyOn(globalThis, 'setInterval').mockImplementation(((cb: any) => {
            tick = cb;
            return 12345 as any;
        }) as any);

        const db = makeFakeDb();
        WriterService.setDb(db);
        const pending = WriterService.bufferAnswer(makeJob());

        WriterService.startFlushTimer();
        // Starting again is a no-op (timer already set).
        WriterService.startFlushTimer();

        expect(tick).toBeTruthy();
        tick!();
        await pending;
        expect(db.inserted.length).toBe(1);

        setIntervalSpy.mockRestore();
    });

    it('shutdown stops the timer and flushes remaining answers', async () => {
        const db = makeFakeDb();
        WriterService.setDb(db);

        const pending = WriterService.bufferAnswer(makeJob('final'));
        await WriterService.shutdown();
        await pending;

        expect(db.inserted.length).toBe(1);
        expect((WriterService as any).flushTimer).toBeNull();
    });
});
