ALTER TYPE "task_status" ADD VALUE IF NOT EXISTS 'IN_PROGRESS' AFTER 'OPEN';
--> statement-breakpoint

-- The next-step invariant must survive a task moving from OPEN to IN_PROGRESS,
-- so the predicate describes "not finished" instead of listing active statuses:
-- referencing the freshly added enum label in the same transaction is unsafe.
DROP INDEX IF EXISTS "tasks_one_open_next_step_per_person_uidx";
--> statement-breakpoint

CREATE UNIQUE INDEX "tasks_one_open_next_step_per_person_uidx"
  ON "tasks" USING btree ("person_id")
  WHERE "person_id" IS NOT NULL
    AND "is_next_step"
    AND "status" <> 'DONE'
    AND "status" <> 'CANCELLED'
    AND "archived_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "tasks_board_idx"
  ON "tasks" USING btree ("status", "due_at")
  WHERE "archived_at" IS NULL;
