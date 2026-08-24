-- Универсальные результаты мероприятий, полная история взаимодействий и
-- временные карточки пользователей Telegram с неполным профилем.

ALTER TABLE "persons" ADD COLUMN "profile_needs_review" boolean DEFAULT false NOT NULL;
ALTER TABLE "persons" ADD COLUMN "profile_review_reason" text;

ALTER TABLE "persons" DROP CONSTRAINT "persons_active_russian_fio_check";
ALTER TABLE "persons" ADD CONSTRAINT "persons_active_russian_fio_check"
	CHECK (
		"archived_at" IS NOT NULL
		OR "merged_into_person_id" IS NOT NULL
		OR (
			"profile_needs_review"
			AND "canonical_full_name" = btrim("canonical_full_name")
			AND char_length("canonical_full_name") BETWEEN 1 AND 500
		)
		OR (
			"last_name" ~ '^[А-Яа-яЁё]+(-[А-Яа-яЁё]+)*$'
			AND "first_name" ~ '^[А-Яа-яЁё]+(-[А-Яа-яЁё]+)*$'
			AND "patronymic" ~ '^[А-Яа-яЁё]+(-[А-Яа-яЁё]+)*$'
			AND "canonical_full_name" = "last_name" || ' ' || "first_name" || ' ' || "patronymic"
		)
	);
ALTER TABLE "persons" ADD CONSTRAINT "persons_profile_review_reason_check"
	CHECK (
		NOT "profile_needs_review"
		OR (
			"profile_review_reason" IS NOT NULL
			AND "profile_review_reason" = btrim("profile_review_reason")
			AND char_length("profile_review_reason") BETWEEN 1 AND 1000
		)
	);
CREATE INDEX "persons_profile_review_idx"
	ON "persons" USING btree ("profile_needs_review", "created_at")
	WHERE "archived_at" IS NULL AND "merged_into_person_id" IS NULL;

ALTER TABLE "event_participations" ADD COLUMN "result" text;
ALTER TABLE "event_participations" ADD CONSTRAINT "event_participations_result_check"
	CHECK (
		"result" IS NULL
		OR ("result" = btrim("result") AND char_length("result") BETWEEN 1 AND 10000)
	);

CREATE TABLE "project_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
	"person_id" uuid NOT NULL REFERENCES "persons"("id") ON DELETE CASCADE,
	"role" text DEFAULT 'Участник' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data_origin" "data_origin" DEFAULT 'LIVE' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_memberships_role_check"
		CHECK ("role" = btrim("role") AND char_length("role") BETWEEN 1 AND 500)
);
CREATE UNIQUE INDEX "project_memberships_project_person_uidx"
	ON "project_memberships" USING btree ("project_id", "person_id")
	WHERE "archived_at" IS NULL;
CREATE INDEX "project_memberships_person_idx"
	ON "project_memberships" USING btree ("person_id", "project_id")
	WHERE "archived_at" IS NULL;

CREATE TABLE "event_project_participations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
	"project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decision" "participation_decision" DEFAULT 'UNKNOWN' NOT NULL,
	"attendance" "attendance_status" DEFAULT 'UNKNOWN' NOT NULL,
	"result" text,
	"data_origin" "data_origin" DEFAULT 'LIVE' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_project_participations_result_check"
		CHECK ("result" IS NULL OR ("result" = btrim("result") AND char_length("result") BETWEEN 1 AND 10000))
);
CREATE UNIQUE INDEX "event_project_participations_event_project_uidx"
	ON "event_project_participations" USING btree ("event_id", "project_id")
	WHERE "archived_at" IS NULL;
CREATE INDEX "event_project_participations_project_idx"
	ON "event_project_participations" USING btree ("project_id", "event_id")
	WHERE "archived_at" IS NULL;

ALTER TYPE "interaction_channel" ADD VALUE IF NOT EXISTS 'NOTE';
ALTER TABLE "interactions" ADD COLUMN "responsible_user_id" uuid
	REFERENCES "app_users"("id") ON DELETE SET NULL;
ALTER TABLE "interactions" ADD COLUMN "next_contact_at" timestamp with time zone;
UPDATE "interactions" SET "responsible_user_id" = "created_by_user_id"
	WHERE "responsible_user_id" IS NULL;
CREATE INDEX "interactions_responsible_next_idx"
	ON "interactions" USING btree ("responsible_user_id", "next_contact_at")
	WHERE "archived_at" IS NULL;

CREATE TABLE "interaction_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"interaction_id" uuid NOT NULL REFERENCES "interactions"("id") ON DELETE CASCADE,
	"file_object_id" uuid NOT NULL REFERENCES "file_objects"("id") ON DELETE RESTRICT,
	"uploaded_by_user_id" uuid REFERENCES "app_users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "interaction_attachments_interaction_file_uidx"
	ON "interaction_attachments" USING btree ("interaction_id", "file_object_id");
CREATE INDEX "interaction_attachments_interaction_idx"
	ON "interaction_attachments" USING btree ("interaction_id", "created_at");

-- Переносим созданные прежней реализацией статичные поля СВЯ/БИ в обычные
-- мероприятия. После миграции названия, даты и результаты полностью управляются
-- через общий интерфейс мероприятий; специальной модели больше нет.
INSERT INTO "events" ("organization_id", "name", "normalized_name", "status")
SELECT DISTINCT person.organization_id,
	CASE result.program_code
		WHEN 'SVYA' THEN 'СВЯ'
		ELSE 'Резиденты БИ Академпарка'
	END,
	CASE result.program_code
		WHEN 'SVYA' THEN 'свя'
		ELSE 'резиденты би академпарка'
	END,
	'COMPLETED'
FROM "person_program_results" result
JOIN "persons" person ON person.id = result.person_id
WHERE result.archived_at IS NULL
ON CONFLICT ("organization_id", "normalized_name") WHERE "archived_at" IS NULL
DO NOTHING;

INSERT INTO "event_participations"
	("person_id", "event_id", "registered_at", "decision", "attendance", "data_origin", "result")
SELECT result.person_id,
	event.id,
	COALESCE(result.occurred_at, result.updated_at),
	'UNKNOWN',
	CASE WHEN result.status IN ('PARTICIPATED', 'FINALIST', 'WINNER', 'RESIDENT')
		THEN 'ATTENDED'::attendance_status ELSE 'UNKNOWN'::attendance_status END,
	'LIVE',
	left(btrim(concat_ws(E'\n', 'Статус: ' || result.status, NULLIF(result.result, ''))), 10000)
FROM "person_program_results" result
JOIN "persons" person ON person.id = result.person_id
JOIN "events" event
	ON event.organization_id = person.organization_id
	AND event.normalized_name = CASE result.program_code
		WHEN 'SVYA' THEN 'свя' ELSE 'резиденты би академпарка' END
	AND event.archived_at IS NULL
WHERE result.archived_at IS NULL
ON CONFLICT ("person_id", "event_id") WHERE "archived_at" IS NULL
DO UPDATE SET
	"result" = EXCLUDED."result",
	"attendance" = CASE
		WHEN event_participations.attendance = 'UNKNOWN' THEN EXCLUDED.attendance
		ELSE event_participations.attendance
	END,
	"updated_at" = now(),
	"version" = event_participations.version + 1;

DROP TABLE "person_program_results";
