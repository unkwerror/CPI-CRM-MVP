-- Keep the legacy UNKNOWN status while preventing unsupported live values.
-- Fail with an actionable precondition error instead of partially enforcing
-- invariants when an older database contains unexpected data.
SET LOCAL lock_timeout = '30s';
--> statement-breakpoint
LOCK TABLE "events" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint

DO $$
DECLARE
  invalid_status_count bigint;
  duplicate_group_count bigint;
BEGIN
  SELECT count(*)
    INTO invalid_status_count
    FROM "events"
   WHERE "status" NOT IN ('UNKNOWN', 'PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

  IF invalid_status_count > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'events status invariant precondition failed: %s row(s) have unsupported statuses',
        invalid_status_count
      ),
      HINT = 'Inspect SELECT status, count(*) FROM events GROUP BY status before retrying the migration.';
  END IF;

  SELECT count(*)
    INTO duplicate_group_count
    FROM (
      SELECT "organization_id", "normalized_name"
        FROM "events"
       WHERE "archived_at" IS NULL
       GROUP BY "organization_id", "normalized_name"
      HAVING count(*) > 1
    ) AS duplicate_groups;

  IF duplicate_group_count > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'events uniqueness invariant precondition failed: %s active duplicate group(s) found',
        duplicate_group_count
      ),
      HINT = 'Resolve duplicate active events by organization_id and normalized_name before retrying the migration.';
  END IF;
END;
$$;
--> statement-breakpoint

ALTER TABLE "events"
  ADD CONSTRAINT "events_status_check"
  CHECK ("status" IN ('UNKNOWN', 'PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED'))
  NOT VALID;
--> statement-breakpoint

ALTER TABLE "events"
  VALIDATE CONSTRAINT "events_status_check";
--> statement-breakpoint

CREATE UNIQUE INDEX "events_organization_normalized_name_uidx"
  ON "events" USING btree ("organization_id", "normalized_name")
  WHERE "archived_at" IS NULL;
--> statement-breakpoint
