-- Generated from packages/shared/src/db/schema.ts by `bun run db:init-sql`
-- (in packages/shared); do not edit by hand. Postgres runs it on the first start
-- of an empty data volume (docker-compose mounts db/init at /docker-entrypoint-initdb.d).

CREATE TYPE "public"."field_type" AS ENUM('text', 'number', 'email', 'select', 'checkbox', 'radio', 'textarea', 'date');
CREATE TYPE "public"."form_status" AS ENUM('draft', 'scheduled', 'open', 'closed');
CREATE TABLE "answers" (
	"id" text PRIMARY KEY NOT NULL,
	"form_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"ip_hash" text,
	"recaptcha_score" integer
);

CREATE TABLE "form_fields" (
	"id" text PRIMARY KEY NOT NULL,
	"form_id" text NOT NULL,
	"field_type" "field_type" NOT NULL,
	"label" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"options" jsonb,
	"max_length" integer,
	"min" integer,
	"max" integer,
	"placeholder" text,
	"help_text" text,
	"error_message" text
);

CREATE TABLE "forms" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"slug" text NOT NULL,
	"schema" jsonb,
	"validation_schema" jsonb,
	"starts_at" timestamp,
	"ends_at" timestamp,
	"status" "form_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "spaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "spaces_slug_unique" UNIQUE("slug")
);

ALTER TABLE "answers" ADD CONSTRAINT "answers_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "forms" ADD CONSTRAINT "forms_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "forms_space_slug_idx" ON "forms" USING btree ("space_id","slug");
