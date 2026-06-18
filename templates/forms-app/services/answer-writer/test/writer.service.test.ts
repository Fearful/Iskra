import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { WriterService } from "../src/domain/writer/writer.service";
import { config } from "../src/app.config.ts";

function makeJob(formId = "form-1") {
    return { formId, data: { name: "x" }, ipHash: "hash", recaptchaScore: 0.9 } as any;
}

// A fake Drizzle-ish db: db.insert(table).values(batch) records the inserted rows.
function makeFakeDb() {
    const inserted: any[] = [];
    return {
        inserted,
        insert() {
            return {
                values: async (batch: any[]) => {
                    inserted.push(...batch);
                },
            };
        },
    };
}

describe("WriterService batching", () => {
    beforeEach(() => {
        WriterService.stopFlushTimer();
        (WriterService as any).buffer = [];
    });

    afterEach(() => {
        WriterService.stopFlushTimer();
    });

    it("buffers answers without flushing below the batch size", async () => {
        const db = makeFakeDb();
        WriterService.setDb(db);

        await WriterService.bufferAnswer(makeJob());
        await WriterService.bufferAnswer(makeJob());

        expect(db.inserted.length).toBe(0);
        expect((WriterService as any).buffer.length).toBe(2);
    });

    it("flushes the buffer to the db and clears it", async () => {
        const db = makeFakeDb();
        WriterService.setDb(db);

        await WriterService.bufferAnswer(makeJob("form-a"));
        await WriterService.flush();

        expect(db.inserted.length).toBe(1);
        expect(db.inserted[0]).toMatchObject({ formId: "form-a", ipHash: "hash", recaptchaScore: 0.9 });
        expect(db.inserted[0].id).toBeDefined();
        expect((WriterService as any).buffer.length).toBe(0);
    });

    it("auto-flushes once the buffer reaches the configured max size", async () => {
        const db = makeFakeDb();
        WriterService.setDb(db);

        for (let i = 0; i < config.batch.maxSize; i++) {
            await WriterService.bufferAnswer(makeJob());
        }

        expect(db.inserted.length).toBe(config.batch.maxSize);
        expect((WriterService as any).buffer.length).toBe(0);
    });

    it("flush is a no-op on an empty buffer", async () => {
        const db = makeFakeDb();
        WriterService.setDb(db);
        await WriterService.flush();
        expect(db.inserted.length).toBe(0);
    });

    it("returns answers to the buffer when the db insert fails", async () => {
        const errSpy = spyOn(console, "error").mockImplementation(() => {});
        WriterService.setDb({
            insert() {
                return {
                    values: async () => {
                        throw new Error("db down");
                    },
                };
            },
        });

        await WriterService.bufferAnswer(makeJob());
        await WriterService.flush();

        expect((WriterService as any).buffer.length).toBe(1);
        errSpy.mockRestore();
    });

    it("the flush timer flushes a non-empty buffer when it fires", async () => {
        let tick: (() => Promise<void>) | null = null;
        const setIntervalSpy = spyOn(globalThis, "setInterval").mockImplementation(((cb: any) => {
            tick = cb;
            return 12345 as any;
        }) as any);

        const db = makeFakeDb();
        WriterService.setDb(db);
        await WriterService.bufferAnswer(makeJob());

        WriterService.startFlushTimer();
        // Starting again is a no-op (timer already set).
        WriterService.startFlushTimer();

        expect(tick).toBeTruthy();
        await tick!();
        expect(db.inserted.length).toBe(1);

        setIntervalSpy.mockRestore();
    });

    it("shutdown stops the timer and flushes remaining answers", async () => {
        const logSpy = spyOn(console, "log").mockImplementation(() => {});
        const db = makeFakeDb();
        WriterService.setDb(db);

        await WriterService.bufferAnswer(makeJob("final"));
        await WriterService.shutdown();

        expect(db.inserted.length).toBe(1);
        expect((WriterService as any).flushTimer).toBeNull();
        logSpy.mockRestore();
    });
});
