ALTER TABLE "persons"
  ADD COLUMN "last_name" text,
  ADD COLUMN "first_name" text,
  ADD COLUMN "patronymic" text;
--> statement-breakpoint

WITH parsed AS (
  SELECT id,
         regexp_split_to_array(
           btrim(regexp_replace(canonical_full_name, '[[:space:]]+', ' ', 'g')),
           ' '
         ) AS parts
    FROM persons
), valid AS (
  SELECT id, parts
    FROM parsed
   WHERE cardinality(parts) = 3
     AND NOT EXISTS (
       SELECT 1 FROM unnest(parts) part
        WHERE part !~ '^[А-Яа-яЁё]+(-[А-Яа-яЁё]+)*$'
     )
)
UPDATE persons person
   SET last_name = valid.parts[1],
       first_name = valid.parts[2],
       patronymic = valid.parts[3],
       canonical_full_name = valid.parts[1] || ' ' || valid.parts[2] || ' ' || valid.parts[3]
  FROM valid
 WHERE person.id = valid.id;
--> statement-breakpoint

CREATE INDEX "persons_name_parts_idx"
  ON "persons" USING btree ("last_name", "first_name", "patronymic");
--> statement-breakpoint

-- Existing invalid rows are handled by the auditable participant-hygiene job
-- before API/worker startup. NOT VALID avoids blocking this migration while the
-- constraint still protects every subsequent insert/update.
ALTER TABLE "persons"
  ADD CONSTRAINT "persons_active_russian_fio_check"
  CHECK (
    "archived_at" IS NOT NULL OR "merged_into_person_id" IS NOT NULL OR (
      "last_name" ~ '^[А-Яа-яЁё]+(-[А-Яа-яЁё]+)*$'
      AND "first_name" ~ '^[А-Яа-яЁё]+(-[А-Яа-яЁё]+)*$'
      AND "patronymic" ~ '^[А-Яа-яЁё]+(-[А-Яа-яЁё]+)*$'
      AND "canonical_full_name" = "last_name" || ' ' || "first_name" || ' ' || "patronymic"
    )
  ) NOT VALID;
--> statement-breakpoint

ALTER TABLE "persons"
  ADD CONSTRAINT "persons_notes_valid_check"
  CHECK (
    "archived_at" IS NOT NULL OR "merged_into_person_id" IS NOT NULL OR "notes" IS NULL OR (
      "notes" = btrim("notes")
      AND char_length("notes") BETWEEN 1 AND 10000
    )
  ) NOT VALID;
--> statement-breakpoint

-- Keep the strongest copy before making duplicate contacts impossible inside a card.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY person_id, type, normalized_value
           ORDER BY is_verified DESC, is_primary DESC, created_at, id
         ) AS position
    FROM contact_points
   WHERE archived_at IS NULL
)
UPDATE contact_points contact
   SET archived_at = now(), is_primary = false,
       updated_at = now(), version = version + 1
  FROM ranked
 WHERE contact.id = ranked.id AND ranked.position > 1;
--> statement-breakpoint

CREATE UNIQUE INDEX "contact_points_person_value_uidx"
  ON "contact_points" USING btree ("person_id", "type", "normalized_value")
  WHERE "archived_at" IS NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX "contact_points_telegram_stable_id_uidx"
  ON "contact_points" USING btree ("messenger_stable_id")
  WHERE "type" = 'TELEGRAM' AND "messenger_stable_id" IS NOT NULL AND "archived_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "contact_points"
  ADD CONSTRAINT "contact_points_telegram_stable_id_check"
  CHECK (
    "type" <> 'TELEGRAM' OR "messenger_stable_id" IS NULL OR "messenger_stable_id" ~ '^[0-9]+$'
  );
