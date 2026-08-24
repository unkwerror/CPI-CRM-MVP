-- Публикация проектов в Telegram и универсальные заявки на создание/вступление.

ALTER TABLE "projects" ADD COLUMN "lead_person_id" uuid
	REFERENCES "persons"("id") ON DELETE SET NULL;
ALTER TABLE "projects" ADD COLUMN "visible_in_bot" boolean DEFAULT false NOT NULL;
CREATE INDEX "projects_bot_catalog_idx"
	ON "projects" USING btree ("organization_id", "status", "updated_at")
	WHERE "visible_in_bot" = true AND "archived_at" IS NULL;
CREATE INDEX "projects_lead_person_idx"
	ON "projects" USING btree ("lead_person_id")
	WHERE "archived_at" IS NULL;

CREATE TABLE "project_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
	"application_type" text NOT NULL,
	"applicant_person_id" uuid NOT NULL REFERENCES "persons"("id") ON DELETE CASCADE,
	"project_id" uuid REFERENCES "projects"("id") ON DELETE CASCADE,
	"proposed_name" text,
	"proposed_description" text,
	"requested_role" text DEFAULT 'Участник' NOT NULL,
	"message" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"reviewed_by_user_id" uuid REFERENCES "app_users"("id") ON DELETE SET NULL,
	"reviewed_by_person_id" uuid REFERENCES "persons"("id") ON DELETE SET NULL,
	"reviewed_at" timestamp with time zone,
	"review_comment" text,
	"created_project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_applications_type_check"
		CHECK ("application_type" IN ('CREATE', 'JOIN')),
	CONSTRAINT "project_applications_status_check"
		CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
	CONSTRAINT "project_applications_payload_check"
		CHECK (
			("application_type" = 'CREATE' AND "project_id" IS NULL
				AND "proposed_name" IS NOT NULL AND "proposed_name" = btrim("proposed_name")
				AND char_length("proposed_name") BETWEEN 1 AND 500)
			OR
			("application_type" = 'JOIN' AND "project_id" IS NOT NULL
				AND "proposed_name" IS NULL)
		),
	CONSTRAINT "project_applications_text_check"
		CHECK (
			"requested_role" = btrim("requested_role")
			AND char_length("requested_role") BETWEEN 1 AND 500
			AND ("proposed_description" IS NULL OR (
				"proposed_description" = btrim("proposed_description")
				AND char_length("proposed_description") BETWEEN 1 AND 10000))
			AND ("message" IS NULL OR (
				"message" = btrim("message") AND char_length("message") BETWEEN 1 AND 5000))
			AND ("review_comment" IS NULL OR (
				"review_comment" = btrim("review_comment")
				AND char_length("review_comment") BETWEEN 1 AND 5000))
		)
);

CREATE UNIQUE INDEX "project_applications_pending_create_uidx"
	ON "project_applications" USING btree ("organization_id", "applicant_person_id")
	WHERE "application_type" = 'CREATE' AND "status" = 'PENDING' AND "archived_at" IS NULL;
CREATE UNIQUE INDEX "project_applications_pending_join_uidx"
	ON "project_applications" USING btree ("project_id", "applicant_person_id")
	WHERE "application_type" = 'JOIN' AND "status" = 'PENDING' AND "archived_at" IS NULL;
CREATE INDEX "project_applications_applicant_idx"
	ON "project_applications" USING btree ("applicant_person_id", "status");
CREATE INDEX "project_applications_project_idx"
	ON "project_applications" USING btree ("project_id", "status");
