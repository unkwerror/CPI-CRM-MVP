INSERT INTO permissions (code, description)
VALUES ('people.delete', 'Безвозвратное удаление персональных данных участника')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin' AND p.code = 'people.delete'
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint

-- Надгробие удалённого участника. Сама карточка исчезает вместе с контактами,
-- поэтому запретить повторное появление можно только по отпечаткам контактов:
-- иначе следующий импорт Excel заведёт человека заново и ему снова напишут.
CREATE TABLE "person_deletion_tombstones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "contact_hashes" text[] DEFAULT '{}'::text[] NOT NULL,
  "name_hash" text NOT NULL,
  "reason" text NOT NULL,
  "deleted_person_id" uuid NOT NULL,
  "deleted_by_user_id" uuid,
  "deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "person_deletion_tombstones_name_hash_check" CHECK ("name_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint

ALTER TABLE "person_deletion_tombstones"
  ADD CONSTRAINT "person_deletion_tombstones_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "person_deletion_tombstones"
  ADD CONSTRAINT "person_deletion_tombstones_deleted_by_user_id_app_users_id_fk"
  FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."app_users"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

CREATE UNIQUE INDEX "person_deletion_tombstones_person_uidx"
  ON "person_deletion_tombstones" USING btree ("deleted_person_id");
--> statement-breakpoint

CREATE INDEX "person_deletion_tombstones_contacts_idx"
  ON "person_deletion_tombstones" USING gin ("contact_hashes");
--> statement-breakpoint

-- Заявка из бота от удалённого человека не должна молча воссоздавать карточку:
-- она уходит в разбор с отдельной причиной.
ALTER TABLE "locker_pending_submissions"
  DROP CONSTRAINT IF EXISTS "locker_pending_submissions_reason_check";
--> statement-breakpoint

ALTER TABLE "locker_pending_submissions"
  ADD CONSTRAINT "locker_pending_submissions_reason_check"
  CHECK ("reason_code" IN ('FIO_REQUIRED', 'PERSON_AMBIGUOUS', 'IDENTITY_CONFLICT', 'DELETED_IDENTITY'));
