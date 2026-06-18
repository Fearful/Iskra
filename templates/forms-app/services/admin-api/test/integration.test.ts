import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { answers } from "@forms-app/shared/db";
import { SpaceService } from "../src/domain/spaces/space.service.ts";
import { FormService } from "../src/domain/forms/form.service.ts";

// Heavy integration: the admin-api domain services against a real Postgres with
// the actual Drizzle schema (FK cascades, enums, unique index). Gated behind a
// credential-checked connection. Use a 5433 test container on this machine
// (native PG occupies 5432): TEST_PG_URL=postgres://postgres:postgres@127.0.0.1:5433/postgres
const PG_URL = process.env.TEST_PG_URL || "postgres://postgres:postgres@127.0.0.1:5432/postgres";

async function pgUsable(url: string): Promise<boolean> {
    try {
        const sql = postgres(url, { max: 1, connect_timeout: 2, idle_timeout: 1, onnotice: () => {} });
        try {
            await sql`SELECT 1`;
            return true;
        } finally {
            await sql.end({ timeout: 1 });
        }
    } catch {
        return false;
    }
}

const DROP = `DROP TABLE IF EXISTS answers, form_fields, forms, spaces CASCADE;
DROP TYPE IF EXISTS form_status, field_type;`;

const SCHEMA = `
CREATE TYPE form_status AS ENUM ('draft','scheduled','open','closed');
CREATE TYPE field_type AS ENUM ('text','number','email','select','checkbox','radio','textarea','date');
CREATE TABLE spaces (
  id text PRIMARY KEY, name text NOT NULL, slug text NOT NULL UNIQUE,
  created_at timestamp DEFAULT now() NOT NULL, updated_at timestamp DEFAULT now() NOT NULL);
CREATE TABLE forms (
  id text PRIMARY KEY,
  space_id text NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  title text NOT NULL, description text, slug text NOT NULL,
  schema jsonb, validation_schema jsonb, starts_at timestamp, ends_at timestamp,
  status form_status NOT NULL DEFAULT 'draft',
  created_at timestamp DEFAULT now() NOT NULL, updated_at timestamp DEFAULT now() NOT NULL);
CREATE UNIQUE INDEX forms_space_slug_idx ON forms(space_id, slug);
CREATE TABLE form_fields (
  id text PRIMARY KEY,
  form_id text NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  field_type field_type NOT NULL, label text NOT NULL, name text NOT NULL,
  position integer NOT NULL DEFAULT 0, required boolean NOT NULL DEFAULT false,
  options jsonb, max_length integer, min integer, max integer,
  placeholder text, help_text text, error_message text);
CREATE TABLE answers (
  id text PRIMARY KEY,
  form_id text NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  data jsonb NOT NULL, submitted_at timestamp DEFAULT now() NOT NULL,
  ip_hash text, recaptcha_score integer);
`;

const pgUp = await pgUsable(PG_URL);

(pgUp ? describe : describe.skip)("admin-api domain services (requires Postgres)", () => {
    let client: ReturnType<typeof postgres>;
    let db: any;

    beforeAll(async () => {
        client = postgres(PG_URL, { max: 4, onnotice: () => {} });
        await client.unsafe(DROP);
        await client.unsafe(SCHEMA);
        db = drizzle(client);
        SpaceService.setDb(db);
        FormService.setDb(db);
    });

    afterAll(async () => {
        await client.unsafe(DROP);
        await client.end();
    });

    it("CRUDs a space", async () => {
        const space = await SpaceService.create({ name: "Acme", slug: "acme" });
        expect(space.id).toBeDefined();

        expect(await SpaceService.findBySlug("acme")).toMatchObject({ name: "Acme" });
        expect((await SpaceService.findById(space.id))?.name).toBe("Acme");
        expect((await SpaceService.findAll()).length).toBeGreaterThanOrEqual(1);

        const updated = await SpaceService.update(space.id, { name: "Acme Inc" });
        expect(updated?.name).toBe("Acme Inc");

        await SpaceService.delete(space.id);
        expect(await SpaceService.findById(space.id)).toBeUndefined();
    });

    it("creates a form with fields, enforces constraints and generates a validation schema", async () => {
        const space = await SpaceService.create({ name: "Forms Co", slug: "forms-co" });

        const form = await FormService.create(space.id, {
            title: "Contact",
            slug: "contact",
            fields: [
                { fieldType: "email", name: "email", label: "Email", position: 0, required: true },
                // maxLength way over the text cap (10000) → must be clamped by enforceConstraints
                { fieldType: "text", name: "msg", label: "Message", position: 1, required: false, maxLength: 99_999_999 },
            ],
        } as any);

        expect(form.fields.length).toBe(2);
        expect(form.status).toBe("draft");
        expect(form.validationSchema.properties.email.format).toBe("email");
        expect(form.validationSchema.required).toContain("email");
        // constraint enforcement flowed into both the stored field and the schema
        expect(form.validationSchema.properties.msg.maxLength).toBe(10000);
        expect(form.fields.find((f: any) => f.name === "msg")?.maxLength).toBe(10000);

        // round-trips from Postgres with fields ordered by position
        const fetched = await FormService.findById(form.id);
        expect(fetched?.fields.map((f: any) => f.name)).toEqual(["email", "msg"]);
        expect(fetched?.validationSchema.properties.email.format).toBe("email");
    });

    it("replaces fields and regenerates the schema on update", async () => {
        const space = await SpaceService.create({ name: "Upd", slug: "upd" });
        const form = await FormService.create(space.id, {
            title: "F", slug: "f",
            fields: [{ fieldType: "text", name: "old", label: "Old", position: 0 }],
        } as any);

        const updated = await FormService.update(form.id, {
            title: "F2",
            fields: [{ fieldType: "number", name: "age", label: "Age", position: 0, required: true, min: 0, max: 120 }],
        } as any);

        expect(updated?.title).toBe("F2");
        expect(updated?.fields.map((f: any) => f.name)).toEqual(["age"]);
        expect(updated?.validationSchema.properties.age).toMatchObject({ type: "number", minimum: 0, maximum: 120 });
        expect(updated?.validationSchema.properties.old).toBeUndefined();

        await FormService.setStatus(form.id, "open");
        expect((await FormService.findById(form.id))?.status).toBe("open");
    });

    it("cascades form and field deletion when a space is deleted", async () => {
        const space = await SpaceService.create({ name: "Casc", slug: "casc" });
        const form = await FormService.create(space.id, {
            title: "C", slug: "c",
            fields: [{ fieldType: "text", name: "a", label: "A", position: 0 }],
        } as any);

        expect(await FormService.findById(form.id)).toBeDefined();

        await SpaceService.delete(space.id);

        // FK ON DELETE CASCADE removed the form (and its fields)
        expect(await FormService.findById(form.id)).toBeUndefined();
    });

    it("paginates answers newest-first", async () => {
        const space = await SpaceService.create({ name: "Ans", slug: "ans" });
        const form = await FormService.create(space.id, { title: "A", slug: "a", fields: [] } as any);

        for (let i = 0; i < 3; i++) {
            await db.insert(answers).values({
                id: `ans-${i}-${form.id}`,
                formId: form.id,
                data: { i },
                submittedAt: new Date(Date.now() + i * 1000),
                ipHash: "h",
                recaptchaScore: 90,
            });
        }

        const page1 = await FormService.getAnswers(form.id, 1, 2);
        expect(page1.total).toBe(3);
        expect(page1.data.length).toBe(2);
        expect(page1.page).toBe(1);

        const page2 = await FormService.getAnswers(form.id, 2, 2);
        expect(page2.data.length).toBe(1);
    });
});
