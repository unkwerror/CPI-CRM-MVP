-- Free-form participant notes. The card shows imported source data here as an
-- editable text instead of the read-only attribute list.
ALTER TABLE persons ADD COLUMN IF NOT EXISTS notes text;
