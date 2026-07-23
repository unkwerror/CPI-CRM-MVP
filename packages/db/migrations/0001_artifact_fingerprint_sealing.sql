-- A file-backed version is submitted before antivirus processing finishes.
-- Permit the worker to seal the initially-null fingerprint exactly once while
-- keeping every other submitted evidence field immutable.
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
    OR (
      NEW.content_fingerprint IS DISTINCT FROM OLD.content_fingerprint
      AND NOT (
        OLD.status = 'SUBMITTED'
        AND OLD.content_fingerprint IS NULL
        AND NEW.content_fingerprint ~ '^[0-9a-f]{64}$'
      )
    )
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
