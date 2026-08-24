-- Операционные дополнения CRM: вложения задач, результаты внешних программ,
-- безопасный архив артефактов и переход новой оценки на шкалу 1–10.

CREATE TABLE "task_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
	"file_object_id" uuid NOT NULL REFERENCES "file_objects"("id") ON DELETE RESTRICT,
	"uploaded_by_user_id" uuid REFERENCES "app_users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "task_attachments_task_file_uidx"
	ON "task_attachments" USING btree ("task_id", "file_object_id");
CREATE INDEX "task_attachments_task_idx"
	ON "task_attachments" USING btree ("task_id", "created_at");

CREATE TABLE "person_program_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL REFERENCES "persons"("id") ON DELETE CASCADE,
	"program_code" text NOT NULL,
	"status" text NOT NULL,
	"result" text,
	"occurred_at" timestamp with time zone,
	"recorded_by_user_id" uuid REFERENCES "app_users"("id") ON DELETE SET NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_program_results_program_check"
		CHECK ("program_code" IN ('SVYA', 'BI_ACADEMPARK')),
	CONSTRAINT "person_program_results_status_check"
		CHECK ("status" IN (
			'PLANNED', 'APPLIED', 'INTERVIEW', 'PARTICIPATED', 'FINALIST',
			'WINNER', 'RESIDENT', 'NOT_SELECTED', 'REJECTED', 'WITHDRAWN'
		)),
	CONSTRAINT "person_program_results_compatibility_check"
		CHECK (
			("program_code" = 'SVYA' AND "status" IN (
				'PLANNED', 'PARTICIPATED', 'FINALIST', 'WINNER', 'NOT_SELECTED', 'WITHDRAWN'
			))
			OR
			("program_code" = 'BI_ACADEMPARK' AND "status" IN (
				'PLANNED', 'APPLIED', 'INTERVIEW', 'RESIDENT', 'REJECTED', 'WITHDRAWN'
			))
		),
	CONSTRAINT "person_program_results_result_check"
		CHECK ("result" IS NULL OR ("result" = btrim("result") AND char_length("result") BETWEEN 1 AND 10000))
);
CREATE UNIQUE INDEX "person_program_results_person_program_uidx"
	ON "person_program_results" USING btree ("person_id", "program_code")
	WHERE "archived_at" IS NULL;
CREATE INDEX "person_program_results_program_status_idx"
	ON "person_program_results" USING btree ("program_code", "status", "updated_at")
	WHERE "archived_at" IS NULL;

ALTER TABLE "artifacts" ADD COLUMN "auto_archived_at" timestamp with time zone;
ALTER TABLE "artifacts" ADD COLUMN "archive_reason" text;
CREATE INDEX "artifacts_archive_queue_idx"
	ON "artifacts" USING btree ("status", "auto_archived_at", "updated_at")
	WHERE "archived_at" IS NULL AND "status" <> 'VOIDED';

-- Исторические нули не переписываем: они остаются читаемым архивом. Новые ревью
-- создаются только по шкале 1–10, а флаг нельзя передать через API.
ALTER TABLE "artifact_reviews" ADD COLUMN "legacy_zero_score" boolean DEFAULT false NOT NULL;
UPDATE "artifact_reviews" SET "legacy_zero_score" = true WHERE "score" = 0;
ALTER TABLE "artifact_reviews" DROP CONSTRAINT "artifact_reviews_score_check";
ALTER TABLE "artifact_reviews" ADD CONSTRAINT "artifact_reviews_score_check"
	CHECK (
		"score" IS NULL
		OR "score" BETWEEN 1 AND 10
		OR ("score" = 0 AND "legacy_zero_score")
	);
