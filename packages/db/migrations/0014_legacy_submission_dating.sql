-- Материалы legacy-мероприятий вошли в базу без даты отправки: в исходной таблице
-- её не было в момент импорта. Такая версия доказывает активацию, но не даёт судить
-- о текущей активности, поэтому автор навсегда застревает в «статус неизвестен».
--
-- Дата у большинства строк всё-таки есть — в сохранённой исходной строке
-- («Отметка времени», «Время создания»). Чтобы её перенести, нужно разрешить
-- заполнить пустое поле. Разрешаем ровно это и только один раз — по образцу
-- дописывания пустого отпечатка файла. Уже известная дата остаётся неизменяемой,
-- заполнение требует причины, будущая дата запрещена.
CREATE OR REPLACE FUNCTION cpi_guard_artifact_version_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  seals_unknown_submission boolean := OLD.status = 'SUBMITTED'
    AND OLD.submitted_at IS NULL
    AND NEW.submitted_at IS NOT NULL
    AND NEW.submitted_at <= now()
    AND OLD.backdate_reason IS NULL
    AND btrim(COALESCE(NEW.backdate_reason, '')) <> '';
BEGIN
  IF OLD.status IN ('SUBMITTED', 'VOIDED') AND (
       NEW.artifact_id IS DISTINCT FROM OLD.artifact_id
    OR NEW.version_number IS DISTINCT FROM OLD.version_number
    OR NEW.content_type IS DISTINCT FROM OLD.content_type
    OR NEW.text_content IS DISTINCT FROM OLD.text_content
    OR (NEW.submitted_at IS DISTINCT FROM OLD.submitted_at AND NOT seals_unknown_submission)
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
    OR (NEW.backdate_reason IS DISTINCT FROM OLD.backdate_reason AND NOT seals_unknown_submission)
  ) THEN
    RAISE EXCEPTION 'submitted artifact version evidence is immutable';
  END IF;
  IF OLD.status = 'VOIDED' AND NEW.status <> 'VOIDED' THEN
    RAISE EXCEPTION 'voided artifact version cannot be restored in place';
  END IF;
  RETURN NEW;
END;
$$;
