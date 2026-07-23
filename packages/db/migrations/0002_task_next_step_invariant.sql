-- Keep the newest open next step if a pre-existing database contains more than
-- one for the same person, then enforce the invariant for all future writes.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY person_id
           ORDER BY created_at DESC, id DESC
         ) AS position
    FROM tasks
   WHERE person_id IS NOT NULL
     AND is_next_step
     AND status = 'OPEN'
     AND archived_at IS NULL
)
UPDATE tasks
   SET is_next_step = false,
       updated_at = now()
 WHERE id IN (SELECT id FROM ranked WHERE position > 1);

CREATE UNIQUE INDEX "tasks_one_open_next_step_per_person_uidx"
  ON "tasks" USING btree ("person_id")
  WHERE "person_id" IS NOT NULL
    AND "is_next_step"
    AND "status" = 'OPEN'
    AND "archived_at" IS NULL;
