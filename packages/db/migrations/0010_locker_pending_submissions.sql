CREATE TYPE "locker_pending_status" AS ENUM ('PENDING', 'RESOLVED', 'REJECTED');
--> statement-breakpoint

CREATE TABLE "locker_pending_submissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "locker_submission_id" uuid NOT NULL,
  "locker_user_id" uuid NOT NULL,
  "telegram_user_id" text NOT NULL,
  "telegram_username" text,
  "reported_full_name" text NOT NULL,
  "reported_phone" text,
  "reported_organization" text,
  "locker_event_id" uuid NOT NULL,
  "event_title" text NOT NULL,
  "submitted_at" timestamp with time zone NOT NULL,
  "payload" jsonb NOT NULL,
  "payload_hash" text NOT NULL,
  "reason_code" text NOT NULL,
  "reason_detail" text,
  "status" "locker_pending_status" DEFAULT 'PENDING' NOT NULL,
  "resolved_person_id" uuid,
  "resolved_by_user_id" uuid,
  "resolved_at" timestamp with time zone,
  "resolution_note" text,
  "attempts" integer DEFAULT 1 NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "locker_pending_submissions_telegram_check" CHECK ("telegram_user_id" ~ '^[0-9]+$'),
  CONSTRAINT "locker_pending_submissions_hash_check" CHECK ("payload_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "locker_pending_submissions_reason_check"
    CHECK ("reason_code" IN ('FIO_REQUIRED', 'PERSON_AMBIGUOUS', 'IDENTITY_CONFLICT')),
  CONSTRAINT "locker_pending_submissions_resolution_check"
    CHECK (
      ("status" = 'PENDING' AND "resolved_at" IS NULL AND "resolved_person_id" IS NULL)
      OR ("status" = 'REJECTED' AND "resolved_at" IS NOT NULL)
      OR ("status" = 'RESOLVED' AND "resolved_at" IS NOT NULL AND "resolved_person_id" IS NOT NULL)
    )
);
--> statement-breakpoint

ALTER TABLE "locker_pending_submissions"
  ADD CONSTRAINT "locker_pending_submissions_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "locker_pending_submissions"
  ADD CONSTRAINT "locker_pending_submissions_resolved_person_id_persons_id_fk"
  FOREIGN KEY ("resolved_person_id") REFERENCES "public"."persons"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "locker_pending_submissions"
  ADD CONSTRAINT "locker_pending_submissions_resolved_by_user_id_app_users_id_fk"
  FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."app_users"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

CREATE UNIQUE INDEX "locker_pending_submissions_submission_uidx"
  ON "locker_pending_submissions" USING btree ("locker_submission_id");
--> statement-breakpoint

CREATE INDEX "locker_pending_submissions_queue_idx"
  ON "locker_pending_submissions" USING btree ("status", "submitted_at");
--> statement-breakpoint

CREATE INDEX "locker_pending_submissions_telegram_idx"
  ON "locker_pending_submissions" USING btree ("telegram_user_id")
  WHERE "status" = 'PENDING';
