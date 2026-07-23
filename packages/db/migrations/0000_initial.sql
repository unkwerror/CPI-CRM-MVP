-- Forward-only baseline for the CPI CRM MVP.
-- PostgreSQL 16+; all application timestamps use timestamptz.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
--> statement-breakpoint
CREATE TYPE "public"."activation_state" AS ENUM('UNKNOWN_LEGACY', 'NOT_ACTIVATED', 'ACTIVATED');--> statement-breakpoint
CREATE TYPE "public"."activity_status" AS ENUM('UNKNOWN', 'ACTIVE', 'MEDIUM', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."person_alias_type" AS ENUM('FORMER_NAME', 'SHORT_NAME', 'TRANSLITERATION', 'MISSPELLING', 'SOURCE_VARIANT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."app_user_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."artifact_asset_type" AS ENUM('FILE', 'EXTERNAL_URL');--> statement-breakpoint
CREATE TYPE "public"."artifact_content_type" AS ENUM('FILE', 'EXTERNAL_URL', 'TEXT', 'MIXED');--> statement-breakpoint
CREATE TYPE "public"."artifact_status" AS ENUM('ACTIVE', 'ARCHIVED', 'VOIDED');--> statement-breakpoint
CREATE TYPE "public"."artifact_version_status" AS ENUM('DRAFT', 'SUBMITTED', 'VOIDED');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('UNKNOWN', 'ATTENDED', 'NO_SHOW', 'PARTIAL');--> statement-breakpoint
CREATE TYPE "public"."consent_status" AS ENUM('GRANTED', 'DENIED', 'UNKNOWN', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."contact_point_type" AS ENUM('EMAIL', 'PHONE', 'TELEGRAM', 'MAX', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."artifact_contribution_role" AS ENUM('AUTHOR', 'CONTRIBUTOR');--> statement-breakpoint
CREATE TYPE "public"."data_origin" AS ENUM('LEGACY_IMPORT', 'LIVE');--> statement-breakpoint
CREATE TYPE "public"."duplicate_candidate_status" AS ENUM('OPEN', 'MERGED', 'NOT_DUPLICATE', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."file_object_status" AS ENUM('PENDING', 'SCANNING', 'AVAILABLE', 'REJECTED', 'QUARANTINED');--> statement-breakpoint
CREATE TYPE "public"."import_run_mode" AS ENUM('DRY_RUN', 'COMMIT', 'REVERT');--> statement-breakpoint
CREATE TYPE "public"."import_run_status" AS ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."interaction_channel" AS ENUM('EMAIL', 'PHONE', 'TELEGRAM', 'MAX', 'IN_PERSON', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."interaction_direction" AS ENUM('INBOUND', 'OUTBOUND', 'INTERNAL');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_data_state" AS ENUM('LEGACY_INCOMPLETE', 'COMPLETE');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_dimension" AS ENUM('ACTIVATION', 'ACTIVITY');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_transition_reason" AS ENUM('ARTIFACT_BECAME_COUNTABLE', 'ARTIFACT_VOIDED', 'TIME_WINDOW_ELAPSED', 'RULE_SET_CHANGED', 'LEGACY_STATE_RESOLVED', 'RECONCILIATION');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('LEAD', 'MEMBER', 'MENTOR', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."merge_item_action" AS ENUM('REASSIGNED', 'CANONICAL_VALUE_SELECTED', 'ARCHIVED', 'RESTORED');--> statement-breakpoint
CREATE TYPE "public"."merge_operation_status" AS ENUM('APPLIED', 'REVERTED', 'PARTIALLY_REVERTED');--> statement-breakpoint
CREATE TYPE "public"."observation_resolution_status" AS ENUM('PENDING', 'RESOLVED', 'REVIEW_REQUIRED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."participation_decision" AS ENUM('UNKNOWN', 'PENDING', 'ACCEPTED', 'REJECTED', 'WAITLISTED');--> statement-breakpoint
CREATE TYPE "public"."queue_item_status" AS ENUM('OPEN', 'RESOLVED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."artifact_review_decision" AS ENUM('NEEDS_REVISION', 'ACCEPTED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."artifact_review_status" AS ENUM('PENDING', 'UNDER_REVIEW', 'FINAL', 'VOIDED');--> statement-breakpoint
CREATE TYPE "public"."source_record_status" AS ENUM('PENDING', 'PARSED', 'QUARANTINED', 'IGNORED');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('OPEN', 'DONE', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "affiliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"role_title" text,
	"faculty" text,
	"department" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"data_origin" "data_origin" NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "affiliations_period_check" CHECK ("affiliations"."valid_to" is null or "affiliations"."valid_from" is null or "affiliations"."valid_to" > "affiliations"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "app_user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"assigned_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"oidc_subject" text NOT NULL,
	"email" text NOT NULL,
	"normalized_email" text NOT NULL,
	"display_name" text NOT NULL,
	"status" "app_user_status" DEFAULT 'ACTIVE' NOT NULL,
	"last_login_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_version_id" uuid NOT NULL,
	"asset_type" "artifact_asset_type" NOT NULL,
	"file_object_id" uuid,
	"external_url" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_assets_exactly_one_content_check" CHECK (num_nonnulls("artifact_assets"."file_object_id", "artifact_assets"."external_url") = 1),
	CONSTRAINT "artifact_assets_type_matches_content_check" CHECK (("artifact_assets"."asset_type" = 'FILE' and "artifact_assets"."file_object_id" is not null) or ("artifact_assets"."asset_type" = 'EXTERNAL_URL' and "artifact_assets"."external_url" is not null)),
	CONSTRAINT "artifact_assets_order_check" CHECK ("artifact_assets"."display_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "artifact_review_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_version_id" uuid NOT NULL,
	"current_final_review_id" uuid NOT NULL,
	"selected_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_version_id" uuid NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"rubric_version_id" uuid NOT NULL,
	"score" smallint,
	"comment" text,
	"status" "artifact_review_status" DEFAULT 'PENDING' NOT NULL,
	"decision" "artifact_review_decision",
	"supersedes_review_id" uuid,
	"reviewed_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_reviews_score_check" CHECK ("artifact_reviews"."score" is null or ("artifact_reviews"."score" between 1 and 10)),
	CONSTRAINT "artifact_reviews_final_fields_check" CHECK ("artifact_reviews"."status" <> 'FINAL' or ("artifact_reviews"."score" is not null and "artifact_reviews"."decision" is not null and "artifact_reviews"."reviewed_at" is not null)),
	CONSTRAINT "artifact_reviews_no_self_supersede_check" CHECK ("artifact_reviews"."supersedes_review_id" is null or "artifact_reviews"."supersedes_review_id" <> "artifact_reviews"."id")
);
--> statement-breakpoint
CREATE TABLE "artifact_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_version_contributors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_version_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"contribution_role" "artifact_contribution_role" NOT NULL,
	"contribution_description" text,
	"authorship_source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" "artifact_version_status" DEFAULT 'DRAFT' NOT NULL,
	"content_type" "artifact_content_type" NOT NULL,
	"text_content" text,
	"submitted_at" timestamp with time zone,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_fingerprint" text,
	"uploaded_by_user_id" uuid,
	"qualifies_for_activation" boolean DEFAULT false NOT NULL,
	"qualifies_for_activity" boolean DEFAULT false NOT NULL,
	"countability_reasons" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"data_origin" "data_origin" NOT NULL,
	"backdate_reason" text,
	"voided_at" timestamp with time zone,
	"voided_by_user_id" uuid,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_versions_number_check" CHECK ("artifact_versions"."version_number" > 0),
	CONSTRAINT "artifact_versions_fingerprint_check" CHECK ("artifact_versions"."content_fingerprint" is null or "artifact_versions"."content_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "artifact_versions_activity_implies_activation_check" CHECK (not "artifact_versions"."qualifies_for_activity" or "artifact_versions"."qualifies_for_activation"),
	CONSTRAINT "artifact_versions_activity_date_check" CHECK (not "artifact_versions"."qualifies_for_activity" or "artifact_versions"."submitted_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"project_id" uuid,
	"program_id" uuid,
	"event_id" uuid,
	"status" "artifact_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_by_user_id" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_subject" text,
	"request_id" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"ip_address" text,
	"user_agent" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cohorts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cohorts_period_check" CHECK ("cohorts"."ends_at" is null or "cohorts"."starts_at" is null or "cohorts"."ends_at" > "cohorts"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"status" "consent_status" DEFAULT 'UNKNOWN' NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"evidence" jsonb,
	"data_origin" "data_origin" NOT NULL,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"type" "contact_point_type" NOT NULL,
	"raw_value" text NOT NULL,
	"normalized_value" text NOT NULL,
	"messenger_stable_id" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"data_origin" "data_origin" NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_points_period_check" CHECK ("contact_points"."valid_to" is null or "contact_points"."valid_from" is null or "contact_points"."valid_to" > "contact_points"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "duplicate_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_a_id" uuid NOT NULL,
	"person_b_id" uuid NOT NULL,
	"confidence_basis_points" integer NOT NULL,
	"evidence_fingerprint" text NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conflicts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "duplicate_candidate_status" DEFAULT 'OPEN' NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" uuid,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duplicate_candidates_pair_order_check" CHECK ("duplicate_candidates"."person_a_id" < "duplicate_candidates"."person_b_id"),
	CONSTRAINT "duplicate_candidates_confidence_check" CHECK ("duplicate_candidates"."confidence_basis_points" between 0 and 10000),
	CONSTRAINT "duplicate_candidates_fingerprint_check" CHECK ("duplicate_candidates"."evidence_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "event_participations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"registered_at" timestamp with time zone,
	"decision" "participation_decision" DEFAULT 'UNKNOWN' NOT NULL,
	"decision_at" timestamp with time zone,
	"attendance" "attendance_status" DEFAULT 'UNKNOWN' NOT NULL,
	"attended_at" timestamp with time zone,
	"data_origin" "data_origin" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"program_id" uuid,
	"cohort_id" uuid,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"owner_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_period_check" CHECK ("events"."ends_at" is null or "events"."starts_at" is null or "events"."ends_at" > "events"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "external_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_namespace" text NOT NULL,
	"external_id" text NOT NULL,
	"person_id" uuid NOT NULL,
	"first_seen_source_record_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"field_name" text NOT NULL,
	"raw_value" jsonb,
	"normalized_value" jsonb,
	"source_record_id" uuid,
	"audit_log_id" uuid,
	"observed_by_user_id" uuid,
	"is_canonical" boolean DEFAULT false NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_observations_provenance_check" CHECK (num_nonnulls("field_observations"."source_record_id", "field_observations"."audit_log_id") >= 1),
	CONSTRAINT "field_observations_period_check" CHECK ("field_observations"."valid_to" is null or "field_observations"."valid_to" > "field_observations"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "file_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket" text NOT NULL,
	"object_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"declared_mime_type" text,
	"detected_mime_type" text,
	"size_bytes" bigint NOT NULL,
	"sha256" text,
	"status" "file_object_status" DEFAULT 'PENDING' NOT NULL,
	"scan_result" jsonb,
	"uploaded_by_user_id" uuid,
	"available_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_objects_size_check" CHECK ("file_objects"."size_bytes" >= 0),
	CONSTRAINT "file_objects_sha256_check" CHECK ("file_objects"."sha256" is null or "file_objects"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject" text NOT NULL,
	"route" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"response_status" integer,
	"response_headers" jsonb,
	"response_body" jsonb,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_records_payload_hash_check" CHECK ("idempotency_records"."payload_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "idempotency_records_response_status_check" CHECK ("idempotency_records"."response_status" is null or ("idempotency_records"."response_status" between 100 and 599))
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_file_object_id" uuid NOT NULL,
	"original_filename" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"importer_version" text NOT NULL,
	"baseline_snapshot_at" timestamp with time zone,
	"timezone_snapshot" text NOT NULL,
	"lifecycle_rule_set_snapshot_id" uuid,
	"uploaded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_batches_size_check" CHECK ("import_batches"."size_bytes" >= 0),
	CONSTRAINT "import_batches_sha256_check" CHECK ("import_batches"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "import_revert_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revert_run_id" uuid NOT NULL,
	"source_entity_link_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "queue_item_status" DEFAULT 'OPEN' NOT NULL,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"mode" "import_run_mode" NOT NULL,
	"parser_version" text NOT NULL,
	"rules_version" text NOT NULL,
	"status" "import_run_status" DEFAULT 'QUEUED' NOT NULL,
	"based_on_run_id" uuid,
	"statistics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"initiated_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_runs_period_check" CHECK ("import_runs"."finished_at" is null or "import_runs"."started_at" is null or "import_runs"."finished_at" >= "import_runs"."started_at"),
	CONSTRAINT "import_runs_no_self_parent_check" CHECK ("import_runs"."based_on_run_id" is null or "import_runs"."based_on_run_id" <> "import_runs"."id")
);
--> statement-breakpoint
CREATE TABLE "interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"project_id" uuid,
	"channel" "interaction_channel" NOT NULL,
	"direction" "interaction_direction" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"outcome" text,
	"comment" text,
	"created_by_user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lifecycle_rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"rule_version" integer NOT NULL,
	"active_window_hours" integer DEFAULT 252 NOT NULL,
	"inactive_after_hours" integer DEFAULT 504 NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by_user_id" uuid,
	"change_comment" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lifecycle_rule_sets_windows_check" CHECK ("lifecycle_rule_sets"."active_window_hours" > 0 and "lifecycle_rule_sets"."inactive_after_hours" > "lifecycle_rule_sets"."active_window_hours"),
	CONSTRAINT "lifecycle_rule_sets_period_check" CHECK ("lifecycle_rule_sets"."effective_to" is null or "lifecycle_rule_sets"."effective_to" > "lifecycle_rule_sets"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "lifecycle_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"dimension" "lifecycle_dimension" NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"reason" "lifecycle_transition_reason" NOT NULL,
	"lifecycle_rule_set_id" uuid,
	"artifact_version_id" uuid,
	"effective_at" timestamp with time zone NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merge_operation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merge_operation_id" uuid NOT NULL,
	"action" "merge_item_action" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"source_person_id" uuid,
	"target_person_id" uuid,
	"field_name" text,
	"before" jsonb,
	"after" jsonb,
	"reverted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merge_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"master_person_id" uuid NOT NULL,
	"duplicate_candidate_id" uuid,
	"cluster_before" jsonb NOT NULL,
	"cluster_after" jsonb NOT NULL,
	"status" "merge_operation_status" DEFAULT 'APPLIED' NOT NULL,
	"reason" text NOT NULL,
	"operated_by_user_id" uuid NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reverted_at" timestamp with time zone,
	"reverted_by_user_id" uuid,
	"revert_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merge_operations_revert_fields_check" CHECK ("merge_operations"."status" = 'APPLIED' or ("merge_operations"."reverted_at" is not null and "merge_operations"."reverted_by_user_id" is not null and "merge_operations"."revert_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "merge_reassignment_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merge_operation_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"candidate_person_ids" jsonb NOT NULL,
	"status" "queue_item_status" DEFAULT 'OPEN' NOT NULL,
	"resolved_person_id" uuid,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "not_duplicate_pairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_a_id" uuid NOT NULL,
	"person_b_id" uuid NOT NULL,
	"evidence_fingerprint" text NOT NULL,
	"reason" text NOT NULL,
	"decided_by_user_id" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "not_duplicate_pairs_pair_order_check" CHECK ("not_duplicate_pairs"."person_a_id" < "not_duplicate_pairs"."person_b_id"),
	CONSTRAINT "not_duplicate_pairs_fingerprint_check" CHECK ("not_duplicate_pairs"."evidence_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "organization_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"artifact_baseline_at" timestamp with time zone,
	"timezone" text DEFAULT 'Asia/Novosibirsk' NOT NULL,
	"current_lifecycle_rule_set_id" uuid,
	"updated_by_user_id" uuid,
	"change_reason" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"short_name" text,
	"kind" text,
	"external_id" text,
	"owner_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "outbox_status" DEFAULT 'PENDING' NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_attempts_check" CHECK ("outbox_events"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"raw_value" text NOT NULL,
	"normalized_value" text NOT NULL,
	"alias_type" "person_alias_type" DEFAULT 'SOURCE_VARIANT' NOT NULL,
	"data_origin" "data_origin" NOT NULL,
	"is_preferred" boolean DEFAULT false NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_aliases_period_check" CHECK ("person_aliases"."valid_to" is null or "person_aliases"."valid_from" is null or "person_aliases"."valid_to" > "person_aliases"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "person_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_record_id" uuid NOT NULL,
	"import_run_id" uuid NOT NULL,
	"slot_key" text NOT NULL,
	"parser_version" text NOT NULL,
	"source_namespace" text,
	"external_id" text,
	"observation_fingerprint" text NOT NULL,
	"raw_values" jsonb NOT NULL,
	"normalized_values" jsonb NOT NULL,
	"resolution_status" "observation_resolution_status" DEFAULT 'PENDING' NOT NULL,
	"resolved_person_id" uuid,
	"resolution_reason" text,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_observations_fingerprint_check" CHECK ("person_observations"."observation_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "person_observations_external_identity_check" CHECK (("person_observations"."source_namespace" is null) = ("person_observations"."external_id" is null)),
	CONSTRAINT "person_observations_resolved_person_check" CHECK ("person_observations"."resolution_status" <> 'RESOLVED' or "person_observations"."resolved_person_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "person_search_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"internal_ids" text DEFAULT '' NOT NULL,
	"canonical_name" text NOT NULL,
	"aliases" text DEFAULT '' NOT NULL,
	"contacts" text DEFAULT '' NOT NULL,
	"organizations" text DEFAULT '' NOT NULL,
	"projects" text DEFAULT '' NOT NULL,
	"artifacts" text DEFAULT '' NOT NULL,
	"search_text" text NOT NULL,
	"search_vector" "tsvector" DEFAULT ''::tsvector NOT NULL,
	"match_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"assigned_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"canonical_full_name" text NOT NULL,
	"normalized_full_name" text NOT NULL,
	"owner_user_id" uuid,
	"lifecycle_data_state" "lifecycle_data_state" DEFAULT 'LEGACY_INCOMPLETE' NOT NULL,
	"activation_state" "activation_state" DEFAULT 'UNKNOWN_LEGACY' NOT NULL,
	"activity_status" "activity_status" DEFAULT 'UNKNOWN' NOT NULL,
	"activated_at" timestamp with time zone,
	"activation_recorded_at" timestamp with time zone,
	"last_artifact_at" timestamp with time zone,
	"next_status_transition_at" timestamp with time zone,
	"applied_lifecycle_rule_set_id" uuid,
	"merged_into_person_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persons_no_self_merge_check" CHECK ("persons"."merged_into_person_id" is null or "persons"."merged_into_person_id" <> "persons"."id")
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"owner_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "programs_period_check" CHECK ("programs"."ends_at" is null or "programs"."starts_at" is null or "programs"."ends_at" > "programs"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "project_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"raw_value" text NOT NULL,
	"normalized_value" text NOT NULL,
	"data_origin" "data_origin" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_team_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_team_links_period_check" CHECK ("project_team_links"."valid_to" is null or "project_team_links"."valid_from" is null or "project_team_links"."valid_to" > "project_team_links"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"program_id" uuid,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"owner_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_period_check" CHECK ("projects"."ends_at" is null or "projects"."starts_at" is null or "projects"."ends_at" > "projects"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubric_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_type_id" uuid,
	"rubric_code" text NOT NULL,
	"version_number" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"anchors" jsonb NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"published_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rubric_versions_number_check" CHECK ("rubric_versions"."version_number" > 0),
	CONSTRAINT "rubric_versions_period_check" CHECK ("rubric_versions"."effective_to" is null or "rubric_versions"."effective_to" > "rubric_versions"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "source_entity_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_record_id" uuid NOT NULL,
	"import_run_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"relation" text NOT NULL,
	"fact_fingerprint" text,
	"created_entity" boolean DEFAULT false NOT NULL,
	"detached_at" timestamp with time zone,
	"detached_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_entity_links_fingerprint_check" CHECK ("source_entity_links"."fact_fingerprint" is null or "source_entity_links"."fact_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "source_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"source_filename" text NOT NULL,
	"sheet_name" text NOT NULL,
	"row_number" integer NOT NULL,
	"raw_json" jsonb NOT NULL,
	"row_hash" text NOT NULL,
	"status" "source_record_status" DEFAULT 'PENDING' NOT NULL,
	"error_code" text,
	"error_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_records_row_number_check" CHECK ("source_records"."row_number" > 0),
	CONSTRAINT "source_records_row_hash_check" CHECK ("source_records"."row_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"color" text,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid,
	"project_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'OPEN' NOT NULL,
	"assignee_user_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"result" text,
	"is_next_step" boolean DEFAULT false NOT NULL,
	"parent_task_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_subject_check" CHECK ("tasks"."person_id" is not null or "tasks"."project_id" is not null),
	CONSTRAINT "tasks_completion_check" CHECK ("tasks"."status" <> 'DONE' or "tasks"."completed_at" is not null),
	CONSTRAINT "tasks_no_self_parent_check" CHECK ("tasks"."parent_task_id" is null or "tasks"."parent_task_id" <> "tasks"."id")
);
--> statement-breakpoint
CREATE TABLE "team_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" "membership_role" DEFAULT 'MEMBER' NOT NULL,
	"role_label" text,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"data_origin" "data_origin" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_memberships_period_check" CHECK ("team_memberships"."valid_to" is null or "team_memberships"."valid_from" is null or "team_memberships"."valid_to" > "team_memberships"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "affiliations" ADD CONSTRAINT "affiliations_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliations" ADD CONSTRAINT "affiliations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user_roles" ADD CONSTRAINT "app_user_roles_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user_roles" ADD CONSTRAINT "app_user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user_roles" ADD CONSTRAINT "app_user_roles_assigned_by_user_id_app_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_assets" ADD CONSTRAINT "artifact_assets_artifact_version_id_artifact_versions_id_fk" FOREIGN KEY ("artifact_version_id") REFERENCES "public"."artifact_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_assets" ADD CONSTRAINT "artifact_assets_file_object_id_file_objects_id_fk" FOREIGN KEY ("file_object_id") REFERENCES "public"."file_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_review_selections" ADD CONSTRAINT "artifact_review_selections_artifact_version_id_artifact_versions_id_fk" FOREIGN KEY ("artifact_version_id") REFERENCES "public"."artifact_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_review_selections" ADD CONSTRAINT "artifact_review_selections_current_final_review_id_artifact_reviews_id_fk" FOREIGN KEY ("current_final_review_id") REFERENCES "public"."artifact_reviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_review_selections" ADD CONSTRAINT "artifact_review_selections_selected_by_user_id_app_users_id_fk" FOREIGN KEY ("selected_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_reviews" ADD CONSTRAINT "artifact_reviews_artifact_version_id_artifact_versions_id_fk" FOREIGN KEY ("artifact_version_id") REFERENCES "public"."artifact_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_reviews" ADD CONSTRAINT "artifact_reviews_reviewer_user_id_app_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_reviews" ADD CONSTRAINT "artifact_reviews_rubric_version_id_rubric_versions_id_fk" FOREIGN KEY ("rubric_version_id") REFERENCES "public"."rubric_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_reviews" ADD CONSTRAINT "artifact_reviews_supersedes_review_id_artifact_reviews_id_fk" FOREIGN KEY ("supersedes_review_id") REFERENCES "public"."artifact_reviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_types" ADD CONSTRAINT "artifact_types_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_version_contributors" ADD CONSTRAINT "artifact_version_contributors_artifact_version_id_artifact_versions_id_fk" FOREIGN KEY ("artifact_version_id") REFERENCES "public"."artifact_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_version_contributors" ADD CONSTRAINT "artifact_version_contributors_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_uploaded_by_user_id_app_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_voided_by_user_id_app_users_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_type_id_artifact_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."artifact_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_recorded_by_user_id_app_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_points" ADD CONSTRAINT "contact_points_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_person_a_id_persons_id_fk" FOREIGN KEY ("person_a_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_person_b_id_persons_id_fk" FOREIGN KEY ("person_b_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_decided_by_user_id_app_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participations" ADD CONSTRAINT "event_participations_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participations" ADD CONSTRAINT "event_participations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_cohort_id_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."cohorts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_owner_user_id_app_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_first_seen_source_record_id_source_records_id_fk" FOREIGN KEY ("first_seen_source_record_id") REFERENCES "public"."source_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_observations" ADD CONSTRAINT "field_observations_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_observations" ADD CONSTRAINT "field_observations_audit_log_id_audit_log_id_fk" FOREIGN KEY ("audit_log_id") REFERENCES "public"."audit_log"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_observations" ADD CONSTRAINT "field_observations_observed_by_user_id_app_users_id_fk" FOREIGN KEY ("observed_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_uploaded_by_user_id_app_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_source_file_object_id_file_objects_id_fk" FOREIGN KEY ("source_file_object_id") REFERENCES "public"."file_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_lifecycle_rule_set_snapshot_id_lifecycle_rule_sets_id_fk" FOREIGN KEY ("lifecycle_rule_set_snapshot_id") REFERENCES "public"."lifecycle_rule_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploaded_by_user_id_app_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_revert_conflicts" ADD CONSTRAINT "import_revert_conflicts_revert_run_id_import_runs_id_fk" FOREIGN KEY ("revert_run_id") REFERENCES "public"."import_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_revert_conflicts" ADD CONSTRAINT "import_revert_conflicts_source_entity_link_id_source_entity_links_id_fk" FOREIGN KEY ("source_entity_link_id") REFERENCES "public"."source_entity_links"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_revert_conflicts" ADD CONSTRAINT "import_revert_conflicts_resolved_by_user_id_app_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_based_on_run_id_import_runs_id_fk" FOREIGN KEY ("based_on_run_id") REFERENCES "public"."import_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_initiated_by_user_id_app_users_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_rule_sets" ADD CONSTRAINT "lifecycle_rule_sets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_rule_sets" ADD CONSTRAINT "lifecycle_rule_sets_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_status_history" ADD CONSTRAINT "lifecycle_status_history_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_status_history" ADD CONSTRAINT "lifecycle_status_history_lifecycle_rule_set_id_lifecycle_rule_sets_id_fk" FOREIGN KEY ("lifecycle_rule_set_id") REFERENCES "public"."lifecycle_rule_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_status_history" ADD CONSTRAINT "lifecycle_status_history_artifact_version_id_artifact_versions_id_fk" FOREIGN KEY ("artifact_version_id") REFERENCES "public"."artifact_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_operation_items" ADD CONSTRAINT "merge_operation_items_merge_operation_id_merge_operations_id_fk" FOREIGN KEY ("merge_operation_id") REFERENCES "public"."merge_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_operation_items" ADD CONSTRAINT "merge_operation_items_source_person_id_persons_id_fk" FOREIGN KEY ("source_person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_operation_items" ADD CONSTRAINT "merge_operation_items_target_person_id_persons_id_fk" FOREIGN KEY ("target_person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_operations" ADD CONSTRAINT "merge_operations_master_person_id_persons_id_fk" FOREIGN KEY ("master_person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_operations" ADD CONSTRAINT "merge_operations_duplicate_candidate_id_duplicate_candidates_id_fk" FOREIGN KEY ("duplicate_candidate_id") REFERENCES "public"."duplicate_candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_operations" ADD CONSTRAINT "merge_operations_operated_by_user_id_app_users_id_fk" FOREIGN KEY ("operated_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_operations" ADD CONSTRAINT "merge_operations_reverted_by_user_id_app_users_id_fk" FOREIGN KEY ("reverted_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_reassignment_queue" ADD CONSTRAINT "merge_reassignment_queue_merge_operation_id_merge_operations_id_fk" FOREIGN KEY ("merge_operation_id") REFERENCES "public"."merge_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_reassignment_queue" ADD CONSTRAINT "merge_reassignment_queue_resolved_person_id_persons_id_fk" FOREIGN KEY ("resolved_person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_reassignment_queue" ADD CONSTRAINT "merge_reassignment_queue_resolved_by_user_id_app_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "not_duplicate_pairs" ADD CONSTRAINT "not_duplicate_pairs_person_a_id_persons_id_fk" FOREIGN KEY ("person_a_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "not_duplicate_pairs" ADD CONSTRAINT "not_duplicate_pairs_person_b_id_persons_id_fk" FOREIGN KEY ("person_b_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "not_duplicate_pairs" ADD CONSTRAINT "not_duplicate_pairs_decided_by_user_id_app_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_current_lifecycle_rule_set_id_lifecycle_rule_sets_id_fk" FOREIGN KEY ("current_lifecycle_rule_set_id") REFERENCES "public"."lifecycle_rule_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_updated_by_user_id_app_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_user_id_app_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_aliases" ADD CONSTRAINT "person_aliases_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_observations" ADD CONSTRAINT "person_observations_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_observations" ADD CONSTRAINT "person_observations_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_observations" ADD CONSTRAINT "person_observations_resolved_person_id_persons_id_fk" FOREIGN KEY ("resolved_person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_observations" ADD CONSTRAINT "person_observations_resolved_by_user_id_app_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_search_documents" ADD CONSTRAINT "person_search_documents_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_tags" ADD CONSTRAINT "person_tags_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_tags" ADD CONSTRAINT "person_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_tags" ADD CONSTRAINT "person_tags_assigned_by_user_id_app_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_owner_user_id_app_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_applied_lifecycle_rule_set_id_lifecycle_rule_sets_id_fk" FOREIGN KEY ("applied_lifecycle_rule_set_id") REFERENCES "public"."lifecycle_rule_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_merged_into_person_id_persons_id_fk" FOREIGN KEY ("merged_into_person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_owner_user_id_app_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_aliases" ADD CONSTRAINT "project_aliases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_team_links" ADD CONSTRAINT "project_team_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_team_links" ADD CONSTRAINT "project_team_links_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_user_id_app_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_versions" ADD CONSTRAINT "rubric_versions_artifact_type_id_artifact_types_id_fk" FOREIGN KEY ("artifact_type_id") REFERENCES "public"."artifact_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_versions" ADD CONSTRAINT "rubric_versions_published_by_user_id_app_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_entity_links" ADD CONSTRAINT "source_entity_links_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_entity_links" ADD CONSTRAINT "source_entity_links_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_entity_links" ADD CONSTRAINT "source_entity_links_detached_by_run_id_import_runs_id_fk" FOREIGN KEY ("detached_by_run_id") REFERENCES "public"."import_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_user_id_app_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_tasks_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "affiliations_person_idx" ON "affiliations" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "affiliations_organization_idx" ON "affiliations" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "affiliations_primary_uidx" ON "affiliations" USING btree ("person_id") WHERE "affiliations"."is_primary" and "affiliations"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_roles_user_role_uidx" ON "app_user_roles" USING btree ("user_id","role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_users_oidc_subject_uidx" ON "app_users" USING btree ("oidc_subject");--> statement-breakpoint
CREATE UNIQUE INDEX "app_users_normalized_email_uidx" ON "app_users" USING btree ("normalized_email") WHERE "app_users"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_assets_version_order_uidx" ON "artifact_assets" USING btree ("artifact_version_id","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_assets_version_file_uidx" ON "artifact_assets" USING btree ("artifact_version_id","file_object_id") WHERE "artifact_assets"."file_object_id" is not null;--> statement-breakpoint
CREATE INDEX "artifact_assets_file_idx" ON "artifact_assets" USING btree ("file_object_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_review_selections_version_uidx" ON "artifact_review_selections" USING btree ("artifact_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_review_selections_review_uidx" ON "artifact_review_selections" USING btree ("current_final_review_id");--> statement-breakpoint
CREATE INDEX "artifact_reviews_version_idx" ON "artifact_reviews" USING btree ("artifact_version_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_reviews_supersedes_uidx" ON "artifact_reviews" USING btree ("supersedes_review_id") WHERE "artifact_reviews"."supersedes_review_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_types_code_uidx" ON "artifact_types" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_version_contributors_fact_uidx" ON "artifact_version_contributors" USING btree ("artifact_version_id","person_id");--> statement-breakpoint
CREATE INDEX "artifact_version_contributors_person_idx" ON "artifact_version_contributors" USING btree ("person_id","contribution_role");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_versions_number_uidx" ON "artifact_versions" USING btree ("artifact_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_versions_active_fingerprint_uidx" ON "artifact_versions" USING btree ("artifact_id","content_fingerprint") WHERE "artifact_versions"."content_fingerprint" is not null and "artifact_versions"."status" <> 'VOIDED';--> statement-breakpoint
CREATE INDEX "artifact_versions_countable_idx" ON "artifact_versions" USING btree ("qualifies_for_activity","submitted_at");--> statement-breakpoint
CREATE INDEX "artifacts_organization_idx" ON "artifacts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "artifacts_project_idx" ON "artifacts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "artifacts_type_idx" ON "artifacts" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_request_idx" ON "audit_log" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cohorts_program_name_uidx" ON "cohorts" USING btree ("program_id","name") WHERE "cohorts"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "consent_records_person_purpose_idx" ON "consent_records" USING btree ("person_id","purpose","recorded_at");--> statement-breakpoint
CREATE INDEX "contact_points_person_idx" ON "contact_points" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "contact_points_normalized_idx" ON "contact_points" USING btree ("type","normalized_value");--> statement-breakpoint
CREATE INDEX "contact_points_messenger_id_idx" ON "contact_points" USING btree ("type","messenger_stable_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_points_primary_type_uidx" ON "contact_points" USING btree ("person_id","type") WHERE "contact_points"."is_primary" and "contact_points"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "duplicate_candidates_pair_evidence_uidx" ON "duplicate_candidates" USING btree ("person_a_id","person_b_id","evidence_fingerprint");--> statement-breakpoint
CREATE INDEX "duplicate_candidates_queue_idx" ON "duplicate_candidates" USING btree ("status","confidence_basis_points","detected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "event_participations_person_event_uidx" ON "event_participations" USING btree ("person_id","event_id") WHERE "event_participations"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "event_participations_event_idx" ON "event_participations" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "events_organization_idx" ON "events" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "events_program_idx" ON "events" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "events_normalized_name_idx" ON "events" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "external_identities_namespace_id_uidx" ON "external_identities" USING btree ("organization_id","source_namespace","external_id") WHERE "external_identities"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "external_identities_person_idx" ON "external_identities" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "field_observations_entity_field_idx" ON "field_observations" USING btree ("entity_type","entity_id","field_name");--> statement-breakpoint
CREATE INDEX "field_observations_source_idx" ON "field_observations" USING btree ("source_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "field_observations_current_canonical_uidx" ON "field_observations" USING btree ("entity_type","entity_id","field_name") WHERE "field_observations"."is_canonical" and "field_observations"."valid_to" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "file_objects_bucket_key_uidx" ON "file_objects" USING btree ("bucket","object_key");--> statement-breakpoint
CREATE INDEX "file_objects_sha256_idx" ON "file_objects" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "file_objects_status_idx" ON "file_objects" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_records_scope_key_uidx" ON "idempotency_records" USING btree ("subject","route","idempotency_key");--> statement-breakpoint
CREATE INDEX "idempotency_records_expiry_idx" ON "idempotency_records" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_org_sha256_uidx" ON "import_batches" USING btree ("organization_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_source_file_uidx" ON "import_batches" USING btree ("source_file_object_id");--> statement-breakpoint
CREATE INDEX "import_revert_conflicts_queue_idx" ON "import_revert_conflicts" USING btree ("revert_run_id","status");--> statement-breakpoint
CREATE INDEX "import_runs_batch_idx" ON "import_runs" USING btree ("batch_id","created_at");--> statement-breakpoint
CREATE INDEX "import_runs_status_idx" ON "import_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "interactions_person_timeline_idx" ON "interactions" USING btree ("person_id","occurred_at");--> statement-breakpoint
CREATE INDEX "interactions_project_idx" ON "interactions" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_rule_sets_org_version_uidx" ON "lifecycle_rule_sets" USING btree ("organization_id","rule_version");--> statement-breakpoint
CREATE INDEX "lifecycle_rule_sets_effective_idx" ON "lifecycle_rule_sets" USING btree ("organization_id","effective_from");--> statement-breakpoint
CREATE INDEX "lifecycle_status_history_person_idx" ON "lifecycle_status_history" USING btree ("person_id","effective_at");--> statement-breakpoint
CREATE INDEX "lifecycle_status_history_detection_idx" ON "lifecycle_status_history" USING btree ("detected_at");--> statement-breakpoint
CREATE INDEX "merge_operation_items_operation_idx" ON "merge_operation_items" USING btree ("merge_operation_id","created_at");--> statement-breakpoint
CREATE INDEX "merge_operation_items_entity_idx" ON "merge_operation_items" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "merge_operations_master_idx" ON "merge_operations" USING btree ("master_person_id","applied_at");--> statement-breakpoint
CREATE INDEX "merge_reassignment_queue_status_idx" ON "merge_reassignment_queue" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "not_duplicate_pairs_pair_evidence_uidx" ON "not_duplicate_pairs" USING btree ("person_a_id","person_b_id","evidence_fingerprint");--> statement-breakpoint
CREATE INDEX "not_duplicate_pairs_active_idx" ON "not_duplicate_pairs" USING btree ("person_a_id","person_b_id","superseded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_settings_organization_uidx" ON "organization_settings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organizations_normalized_name_idx" ON "organizations" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_external_id_uidx" ON "organizations" USING btree ("external_id") WHERE "organizations"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "outbox_events_delivery_idx" ON "outbox_events" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "outbox_events_aggregate_idx" ON "outbox_events" USING btree ("aggregate_type","aggregate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_code_uidx" ON "permissions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "person_aliases_normalized_idx" ON "person_aliases" USING btree ("normalized_value");--> statement-breakpoint
CREATE UNIQUE INDEX "person_aliases_fact_uidx" ON "person_aliases" USING btree ("person_id","normalized_value","alias_type") WHERE "person_aliases"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "person_aliases_preferred_uidx" ON "person_aliases" USING btree ("person_id") WHERE "person_aliases"."is_preferred" and "person_aliases"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "person_observations_record_slot_parser_uidx" ON "person_observations" USING btree ("source_record_id","slot_key","parser_version");--> statement-breakpoint
CREATE INDEX "person_observations_resolution_queue_idx" ON "person_observations" USING btree ("resolution_status","created_at");--> statement-breakpoint
CREATE INDEX "person_observations_fingerprint_idx" ON "person_observations" USING btree ("observation_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "person_search_documents_person_uidx" ON "person_search_documents" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "person_search_documents_vector_idx" ON "person_search_documents" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "person_search_documents_name_trgm_idx" ON "person_search_documents" USING gin ("canonical_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "person_search_documents_text_trgm_idx" ON "person_search_documents" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "person_tags_person_tag_uidx" ON "person_tags" USING btree ("person_id","tag_id");--> statement-breakpoint
CREATE INDEX "persons_organization_idx" ON "persons" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "persons_normalized_full_name_idx" ON "persons" USING btree ("normalized_full_name");--> statement-breakpoint
CREATE INDEX "persons_owner_idx" ON "persons" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "persons_lifecycle_queue_idx" ON "persons" USING btree ("activity_status","next_status_transition_at");--> statement-breakpoint
CREATE INDEX "persons_merged_into_idx" ON "persons" USING btree ("merged_into_person_id");--> statement-breakpoint
CREATE INDEX "programs_organization_idx" ON "programs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "programs_normalized_name_idx" ON "programs" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "project_aliases_project_value_uidx" ON "project_aliases" USING btree ("project_id","normalized_value") WHERE "project_aliases"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "project_aliases_normalized_idx" ON "project_aliases" USING btree ("normalized_value");--> statement-breakpoint
CREATE UNIQUE INDEX "project_team_links_active_fact_uidx" ON "project_team_links" USING btree ("project_id","team_id") WHERE "project_team_links"."valid_to" is null and "project_team_links"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "projects_organization_idx" ON "projects" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "projects_normalized_name_idx" ON "projects" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_role_permission_uidx" ON "role_permissions" USING btree ("role_id","permission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_code_uidx" ON "roles" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_versions_code_version_uidx" ON "rubric_versions" USING btree ("rubric_code","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "source_entity_links_fact_uidx" ON "source_entity_links" USING btree ("source_record_id","entity_type","relation","entity_id");--> statement-breakpoint
CREATE INDEX "source_entity_links_entity_idx" ON "source_entity_links" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "source_entity_links_run_idx" ON "source_entity_links" USING btree ("import_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_records_sheet_row_uidx" ON "source_records" USING btree ("batch_id","sheet_name","row_number");--> statement-breakpoint
CREATE INDEX "source_records_status_idx" ON "source_records" USING btree ("batch_id","status");--> statement-breakpoint
CREATE INDEX "source_records_row_hash_idx" ON "source_records" USING btree ("row_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_org_normalized_name_uidx" ON "tags" USING btree ("organization_id","normalized_name") WHERE "tags"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "tasks_assignee_queue_idx" ON "tasks" USING btree ("assignee_user_id","status","due_at");--> statement-breakpoint
CREATE INDEX "tasks_person_idx" ON "tasks" USING btree ("person_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "team_memberships_active_fact_uidx" ON "team_memberships" USING btree ("team_id","person_id","role") WHERE "team_memberships"."valid_to" is null and "team_memberships"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "team_memberships_person_idx" ON "team_memberships" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "teams_normalized_name_idx" ON "teams" USING btree ("normalized_name");
--> statement-breakpoint
-- Keep the full-text document transactionally consistent with its readable parts.
CREATE OR REPLACE FUNCTION cpi_refresh_person_search_vector()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_vector :=
      setweight(to_tsvector('simple', coalesce(NEW.canonical_name, '')), 'A')
    || setweight(to_tsvector('simple', coalesce(NEW.aliases, '')), 'A')
    || setweight(to_tsvector('simple', coalesce(NEW.contacts, '')), 'A')
    || setweight(to_tsvector('simple', coalesce(NEW.organizations, '')), 'B')
    || setweight(to_tsvector('simple', coalesce(NEW.projects, '')), 'B')
    || setweight(to_tsvector('simple', coalesce(NEW.artifacts, '')), 'C')
    || setweight(to_tsvector('simple', coalesce(NEW.internal_ids, '')), 'A');
  NEW.rebuilt_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER person_search_documents_refresh_vector
BEFORE INSERT OR UPDATE OF internal_ids, canonical_name, aliases, contacts, organizations, projects, artifacts, search_text
ON person_search_documents
FOR EACH ROW
EXECUTE FUNCTION cpi_refresh_person_search_vector();
--> statement-breakpoint

-- Imported source payload and coordinates never change; parsing state may advance.
CREATE OR REPLACE FUNCTION cpi_guard_source_record_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'source_records are append-only';
  END IF;
  IF NEW.batch_id IS DISTINCT FROM OLD.batch_id
     OR NEW.source_filename IS DISTINCT FROM OLD.source_filename
     OR NEW.sheet_name IS DISTINCT FROM OLD.sheet_name
     OR NEW.row_number IS DISTINCT FROM OLD.row_number
     OR NEW.raw_json IS DISTINCT FROM OLD.raw_json
     OR NEW.row_hash IS DISTINCT FROM OLD.row_hash THEN
    RAISE EXCEPTION 'source record payload and coordinates are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER source_records_immutability
BEFORE UPDATE OR DELETE ON source_records
FOR EACH ROW
EXECUTE FUNCTION cpi_guard_source_record_immutability();
--> statement-breakpoint

-- A submitted version can only be voided; its evidence remains unchanged.
CREATE OR REPLACE FUNCTION cpi_guard_artifact_version_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('SUBMITTED', 'VOIDED') AND (
       NEW.artifact_id IS DISTINCT FROM OLD.artifact_id
    OR NEW.version_number IS DISTINCT FROM OLD.version_number
    OR NEW.content_type IS DISTINCT FROM OLD.content_type
    OR NEW.text_content IS DISTINCT FROM OLD.text_content
    OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
    OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
    OR NEW.content_fingerprint IS DISTINCT FROM OLD.content_fingerprint
    OR NEW.uploaded_by_user_id IS DISTINCT FROM OLD.uploaded_by_user_id
    OR NEW.data_origin IS DISTINCT FROM OLD.data_origin
    OR NEW.backdate_reason IS DISTINCT FROM OLD.backdate_reason
  ) THEN
    RAISE EXCEPTION 'submitted artifact version evidence is immutable';
  END IF;
  IF OLD.status = 'VOIDED' AND NEW.status <> 'VOIDED' THEN
    RAISE EXCEPTION 'voided artifact version cannot be restored in place';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER artifact_versions_immutability
BEFORE UPDATE ON artifact_versions
FOR EACH ROW
EXECUTE FUNCTION cpi_guard_artifact_version_immutability();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cpi_guard_submitted_version_children()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status artifact_version_status;
  parent_id uuid;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.artifact_version_id ELSE NEW.artifact_version_id END;
  SELECT status INTO parent_status FROM artifact_versions WHERE id = parent_id;
  IF parent_status IN ('SUBMITTED', 'VOIDED') THEN
    RAISE EXCEPTION 'contributors and assets of a submitted version are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER artifact_version_contributors_immutability
BEFORE INSERT OR UPDATE OR DELETE ON artifact_version_contributors
FOR EACH ROW
EXECUTE FUNCTION cpi_guard_submitted_version_children();
--> statement-breakpoint
CREATE TRIGGER artifact_assets_immutability
BEFORE INSERT OR UPDATE OR DELETE ON artifact_assets
FOR EACH ROW
EXECUTE FUNCTION cpi_guard_submitted_version_children();
--> statement-breakpoint

-- The current pointer must select a FINAL review of the same artifact version.
CREATE OR REPLACE FUNCTION cpi_validate_current_final_review()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  review_version_id uuid;
  review_status artifact_review_status;
BEGIN
  SELECT artifact_version_id, status
    INTO review_version_id, review_status
    FROM artifact_reviews
   WHERE id = NEW.current_final_review_id;
  IF review_version_id IS DISTINCT FROM NEW.artifact_version_id OR review_status <> 'FINAL' THEN
    RAISE EXCEPTION 'current review must be FINAL and belong to the selected artifact version';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER artifact_review_selections_validate
BEFORE INSERT OR UPDATE ON artifact_review_selections
FOR EACH ROW
EXECUTE FUNCTION cpi_validate_current_final_review();
--> statement-breakpoint

-- Audit records are immutable evidence.
CREATE OR REPLACE FUNCTION cpi_reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW
EXECUTE FUNCTION cpi_reject_audit_mutation();
--> statement-breakpoint

INSERT INTO permissions (code, description)
VALUES
  ('people.read', 'Просмотр участников'),
  ('people.write', 'Изменение участников'),
  ('contacts.read', 'Просмотр контактов'),
  ('contacts.write', 'Изменение контактов'),
  ('artifacts.read', 'Просмотр артефактов'),
  ('artifacts.write', 'Создание и изменение артефактов'),
  ('artifacts.review', 'Итоговая оценка версий артефактов'),
  ('tasks.manage', 'Управление задачами и взаимодействиями'),
  ('imports.run', 'Запуск dry-run, commit и revert импорта'),
  ('imports.read_raw', 'Просмотр ограниченного raw staging'),
  ('duplicates.resolve', 'Решение дублей, merge и unmerge'),
  ('audit.read', 'Просмотр журнала действий'),
  ('settings.manage', 'Изменение настроек и справочников'),
  ('exports.bulk', 'Массовый экспорт')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

INSERT INTO roles (code, name, description, is_system)
VALUES
  ('admin', 'Администратор', 'Полный доступ, настройки и аудит', true),
  ('community_manager', 'Комьюнити-менеджер', 'Участники, артефакты и операционная работа', true),
  ('methodologist', 'Методолог', 'Методика и оценка артефактов', true),
  ('data_steward', 'Дата-стюард', 'Импорт, качество данных и дубли', true),
  ('auditor', 'Аудитор', 'Разрешённое чтение и аудит без мутаций', true)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = ANY (ARRAY[
  'people.read', 'people.write', 'contacts.read', 'contacts.write',
  'artifacts.read', 'artifacts.write', 'tasks.manage'
])
WHERE r.code = 'community_manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = ANY (ARRAY['people.read', 'artifacts.read', 'artifacts.review'])
WHERE r.code = 'methodologist'
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = ANY (ARRAY[
  'people.read', 'people.write', 'contacts.read',
  'imports.run', 'imports.read_raw', 'duplicates.resolve', 'audit.read'
])
WHERE r.code = 'data_steward'
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = ANY (ARRAY[
  'people.read', 'contacts.read', 'artifacts.read', 'audit.read'
])
WHERE r.code = 'auditor'
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint

INSERT INTO artifact_types (code, name, description, is_system)
VALUES
  ('PITCH_DECK', 'Презентация / pitch deck', null, true),
  ('CODE_REPOSITORY', 'Код или репозиторий', null, true),
  ('APPLICATION', 'Заявка', null, true),
  ('INTERVIEW', 'Интервью', null, true),
  ('FINANCIAL_MODEL', 'Финансовая модель', null, true),
  ('HOMEWORK', 'Домашнее задание', null, true),
  ('REPORT_RESEARCH', 'Отчёт / исследование', null, true),
  ('PROTOTYPE_MVP', 'Прототип / MVP', null, true),
  ('OTHER', 'Другое', null, true)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

INSERT INTO rubric_versions (
  rubric_code, version_number, name, description, anchors, effective_from
)
VALUES (
  'CPI_ARTIFACT_QUALITY',
  1,
  'Качество артефакта 1–10',
  'Базовая неизменяемая шкала MVP',
  '{
    "1":"Содержательного результата почти нет",
    "2":"Есть отдельный фрагмент, задача не решена",
    "3":"Существенно неполный сырой результат",
    "4":"Результат понятен, но содержит критические пробелы",
    "5":"Минимально завершённый результат",
    "6":"Применим после заметной доработки",
    "7":"Добротный и практически применимый результат",
    "8":"Высокое качество, нужны небольшие улучшения",
    "9":"Готов к внешнему использованию",
    "10":"Эталонный результат, пригодный как образец"
  }'::jsonb,
  '2026-07-22T00:00:00Z'::timestamptz
)
ON CONFLICT (rubric_code, version_number) DO NOTHING;
