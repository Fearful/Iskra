import { answers } from '@forms-app/shared/db';
import { v4 as uuidv4 } from 'uuid';
import type { AnswerJob } from '@forms-app/shared';
import { config } from '../../app.config.ts';

interface PendingAnswer {
    id: string;
    formId: string;
    data: Record<string, unknown>;
    submittedAt: Date;
    ipHash: string;
    recaptchaScore: number;
}

export class WriterService {
    private static db: any;
    private static buffer: PendingAnswer[] = [];
    private static flushTimer: ReturnType<typeof setInterval> | null = null;

    static setDb(db: any) {
        this.db = db;
    }

    static startFlushTimer(): void {
        if (this.flushTimer) return;

        this.flushTimer = setInterval(async () => {
            if (this.buffer.length > 0) {
                await this.flush();
            }
        }, config.batch.flushIntervalMs);
    }

    static stopFlushTimer(): void {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
    }

    static async bufferAnswer(job: AnswerJob): Promise<void> {
        this.buffer.push({
            id: uuidv4(),
            formId: job.formId,
            data: job.data,
            submittedAt: new Date(),
            ipHash: job.ipHash,
            recaptchaScore: job.recaptchaScore,
        });

        // Flush if buffer is full
        if (this.buffer.length >= config.batch.maxSize) {
            await this.flush();
        }
    }

    static async flush(): Promise<void> {
        if (this.buffer.length === 0) return;

        const batch = this.buffer.splice(0, this.buffer.length);

        try {
            await this.db.insert(answers).values(batch);
            console.log(`Flushed ${batch.length} answers to database`);
        } catch (err) {
            console.error(`Failed to flush ${batch.length} answers:`, err);
            // Put failed items back at the front of the buffer
            this.buffer.unshift(...batch);
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
