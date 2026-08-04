ALTER TABLE "file_objects"
  ADD COLUMN "storage_provider" text DEFAULT 'CRM' NOT NULL,
  ADD COLUMN "external_id" text;
--> statement-breakpoint

ALTER TABLE "file_objects"
  ADD CONSTRAINT "file_objects_storage_provider_check"
  CHECK ("storage_provider" IN ('CRM', 'LOCKER'));
--> statement-breakpoint

ALTER TABLE "file_objects"
  ADD CONSTRAINT "file_objects_external_storage_check"
  CHECK (
    ("storage_provider" = 'CRM' AND "external_id" IS NULL)
    OR
    ("storage_provider" = 'LOCKER' AND "external_id" IS NOT NULL)
  );
--> statement-breakpoint

CREATE UNIQUE INDEX "file_objects_provider_external_uidx"
  ON "file_objects" USING btree ("storage_provider", "external_id")
  WHERE "external_id" IS NOT NULL;
--> statement-breakpoint

CREATE TABLE "locker_event_links" (
  "locker_event_id" uuid PRIMARY KEY NOT NULL,
  "event_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "locker_event_links"
  ADD CONSTRAINT "locker_event_links_event_id_events_id_fk"
  FOREIGN KEY ("event_id") REFERENCES "public"."events"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "locker_event_links_event_idx"
  ON "locker_event_links" USING btree ("event_id");
--> statement-breakpoint

CREATE TABLE "locker_submission_links" (
  "locker_submission_id" uuid PRIMARY KEY NOT NULL,
  "locker_user_id" uuid NOT NULL,
  "telegram_user_id" text NOT NULL,
  "person_id" uuid NOT NULL,
  "locker_event_id" uuid NOT NULL,
  "event_id" uuid NOT NULL,
  "artifact_id" uuid NOT NULL,
  "artifact_version_id" uuid NOT NULL,
  "payload_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "locker_submission_links_telegram_check" CHECK ("telegram_user_id" ~ '^[0-9]+$'),
  CONSTRAINT "locker_submission_links_hash_check" CHECK ("payload_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint

ALTER TABLE "locker_submission_links"
  ADD CONSTRAINT "locker_submission_links_person_id_persons_id_fk"
  FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "locker_submission_links"
  ADD CONSTRAINT "locker_submission_links_event_id_events_id_fk"
  FOREIGN KEY ("event_id") REFERENCES "public"."events"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "locker_submission_links"
  ADD CONSTRAINT "locker_submission_links_artifact_id_artifacts_id_fk"
  FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "locker_submission_links"
  ADD CONSTRAINT "locker_submission_links_artifact_version_id_artifact_versions_id_fk"
  FOREIGN KEY ("artifact_version_id") REFERENCES "public"."artifact_versions"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

CREATE UNIQUE INDEX "locker_submission_links_artifact_uidx"
  ON "locker_submission_links" USING btree ("artifact_id");
--> statement-breakpoint

CREATE UNIQUE INDEX "locker_submission_links_version_uidx"
  ON "locker_submission_links" USING btree ("artifact_version_id");
--> statement-breakpoint

CREATE INDEX "locker_submission_links_person_idx"
  ON "locker_submission_links" USING btree ("person_id", "created_at");
