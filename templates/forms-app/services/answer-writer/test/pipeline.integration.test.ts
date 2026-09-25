import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { App } from "@iskra-bun/core";
import { WorkerManager } from "@iskra-bun/worker-kit";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { answers } from "@forms-app/shared/db";
import { JOB_NAMES, type AnswerJob } from "@forms-app/shared";
import { WriterService } from "../src/domain/writer/writer.service.ts";
import { SubmissionService } from "../../forms-api/src/domain/submission/submission.service.ts";

// Heavy end-to-end: forms-api SubmissionService.enqueueAnswer → real BullMQ on
// Redis → answer-writer consumer (WorkerManager) → WriterService → real Postgres.
// Gated behind BOTH Redis and Postgres. On this machine use a 5433 PG container.
const REDIS_URL = process.env.TEST_REDIS_URL || "redis://127.0.0.1:6379";
const PG_URL = process.env.TEST_PG_URL || "postgres://postgres:postgres@127.0.0.1:5432/postgres";

async function redisReachable(): Promise<boolean> {
    const url = new URL(REDIS_URL);
    return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 1000);
        Bun.connect({
            hostname: url.hostname,
            port: Number(url.port) || 6379,
            socket: {
                data() {},
                open(s) { clearTimeout(timer); s.end(); resolve(true); },
                connectError() { clearTimeout(timer); resolve(false); },
            },
        }).catch(() => { clearTimeout(timer); resolve(false); });
    });
}

async function pgUsable(url: string): Promise<boolean> {
    try {
        const sql = postgres(url, { max: 1, connect_timeout: 2, idle_timeout: 1, onnotice: () => {} });
        try { await sql`SELECT 1`; return true; } finally { await sql.end({ timeout: 1 }); }
    } catch { return false; }
}

const SCHEMA = `
DROP TABLE IF EXISTS answers, form_fields, forms, spaces CASCADE;
DROP TYPE IF EXISTS form_status, field_type;
CREATE TYPE form_status AS ENUM ('draft','scheduled','open','closed');
CREATE TABLE spaces (id text PRIMARY KEY, name text NOT NULL, slug text NOT NULL UNIQUE,
  created_at timestamp DEFAULT now() NOT NULL, updated_at timestamp DEFAULT now() NOT NULL);
CREATE TABLE forms (id text PRIMARY KEY, space_id text NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  title text NOT NULL, description text, slug text NOT NULL, schema jsonb, validation_schema jsonb,
  starts_at timestamp, ends_at timestamp, status form_status NOT NULL DEFAULT 'draft',
  created_at timestamp DEFAULT now() NOT NULL, updated_at timestamp DEFAULT now() NOT NULL);
CREATE TABLE answers (id text PRIMARY KEY, form_id text NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  data jsonb NOT NULL, submitted_at timestamp DEFAULT now() NOT NULL, ip_hash text, recaptcha_score integer);
`;

const enabled = (await redisReachable()) && (await pgUsable(PG_URL));

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 6000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await predicate()) return;
        await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("Timed out waiting for condition");
}

(enabled ? describe : describe.skip)("answer pipeline e2e (requires Redis + Postgres)", () => {
    const queueName = `iskra-e2e-${Date.now()}`;
    const FORM_ID = "form-e2e";
    let client: ReturnType<typeof postgres>;
    let db: any;
    let app: App;
    let wm: WorkerManager;

    beforeAll(async () => {
        client = postgres(PG_URL, { max: 4, onnotice: () => {} });
        await client.unsafe(SCHEMA);
        await client.unsafe(
            `INSERT INTO spaces (id, name, slug) VALUES ('sp-e2e', 'E2E', 'e2e');
             INSERT INTO forms (id, space_id, title, slug, status) VALUES ('${FORM_ID}', 'sp-e2e', 'F', 'f', 'open');`,
        );
        db = drizzle(client);

        // Reset the static WriterService state and point it at the real DB.
        (WriterService as any).buffer = [];
        WriterService.stopFlushTimer();
        WriterService.setDb(db);

        app = new App({ name: "PipelineE2E", logger: { level: "error" } });
        wm = new WorkerManager({ connection: REDIS_URL, queueName, concurrency: 1 });
        wm.register<AnswerJob>(JOB_NAMES.ANSWER_SUBMIT, async (job) => {
            await WriterService.bufferAnswer(job.data);
        });
        await wm.init(app);
        await wm.start();

        SubmissionService.setWorker(wm);
    });

    afterAll(async () => {
        WriterService.stopFlushTimer();
        await wm.stop();
        await client.unsafe("DROP TABLE IF EXISTS answers, form_fields, forms, spaces CASCADE; DROP TYPE IF EXISTS form_status, field_type;");
        await client.end();
    });

    it("carries a submitted answer through BullMQ into Postgres", async () => {
        await SubmissionService.enqueueAnswer(FORM_ID, { name: "Ada", msg: "hi" }, "ip-hash-xyz", 0.91);

        // The consumer buffers the job; wait for it, then flush to Postgres.
        await waitFor(() => (WriterService as any).buffer.length > 0);
        await WriterService.flush();

        const rows = await db.select().from(answers).where(eq(answers.formId, FORM_ID));
        expect(rows.length).toBe(1);
        expect(rows[0].data).toEqual({ name: "Ada", msg: "hi" });
        expect(rows[0].ipHash).toBe("ip-hash-xyz");
        // SubmissionService scales the reCAPTCHA score to an integer (0.91 → 91)
        expect(rows[0].recaptchaScore).toBe(91);
        expect(rows[0].formId).toBe(FORM_ID);
    });
});
