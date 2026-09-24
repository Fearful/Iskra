import { answers } from '@forms-app/shared/db';
import { v4 as uuidv4 } from 'uuid';
import type { AnswerJob } from '@forms-app/shared';
import { config } from '../../app.config.ts';

interface AnswerRow {
    id: string;
    formId: string;
    data: Record<string, unknown>;
    submittedAt: Date;
    ipHash: string;
    recaptchaScore: number;
}

interface PendingAnswer {
    row: AnswerRow;
    /** Settles the job that submitted it: completed once stored, failed (and retried) otherwise. */
    resolve: () => void;
    reject: (error: unknown) => void;
}

/**
 * Buffers answers and inserts them in batches. A job completes only when its
 * answer is stored: it used to complete when buffered, so a crash lost the
 * buffer. A failed batch is retried row by row, so one bad answer (for a form
 * deleted since it was queued, say) fails only its own job, which BullMQ
 * retries and then keeps as failed; it used to be put back at the front of
 * the buffer and fail every later batch with it, forever.
 */
export class WriterService {
    private static db: any;
    private static buffer: PendingAnswer[] = [];
    private static flushTimer: ReturnType<typeof setInterval> | null = null;

    static setDb(db: any) {
        this.db = db;
    }

    static startFlushTimer(): void {
        if (this.flushTimer) return;

        this.flushTimer = setInterval(() => {
            if (this.buffer.length > 0) void this.flush();
        }, config.batch.flushIntervalMs);
    }

    static stopFlushTimer(): void {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
    }

    /** Resolves once the answer is in the database. */
    static bufferAnswer(job: AnswerJob): Promise<void> {
        return new Promise((resolve, reject) => {
            this.buffer.push({
                row: {
                    id: uuidv4(),
                    formId: job.formId,
                    data: job.data,
                    submittedAt: new Date(),
                    ipHash: job.ipHash,
                    recaptchaScore: job.recaptchaScore,
                },
                resolve,
                reject,
            });

            // Flush if buffer is full
            if (this.buffer.length >= config.batch.maxSize) void this.flush();
        });
    }

    static async flush(): Promise<void> {
        if (this.buffer.length === 0) return;

        const batch = this.buffer.splice(0, this.buffer.length);

        try {
            await this.db.insert(answers).values(batch.map((p) => p.row));
            console.log(`Flushed ${batch.length} answers to database`);
            for (const pending of batch) pending.resolve();
        } catch (err) {
            console.error(`Failed to flush ${batch.length} answers, retrying one by one:`, err);
            for (const pending of batch) {
                try {
                    await this.db.insert(answers).values(pending.row);
                    pending.resolve();
                } catch (rowErr) {
                    pending.reject(rowErr);
                }
            }
        }
    }

    static async shutdown(): Promise<void> {
        this.stopFlushTimer();
        // Final flush
        if (this.buffer.length > 0) {
            console.log(`Flushing ${this.buffer.length} remaining answers before shutdown`);
            await this.flush();
        }
    }
}
