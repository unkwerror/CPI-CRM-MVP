-- Вложения рассылки: фотографии и документы.
--
-- Файл живёт в общем хранилище (file_objects), поэтому вложение проходит тот же
-- антивирус, что и артефакты, и не дублирует байты. Тип задаётся вручную, а не
-- выводится из MIME: одна и та же картинка бывает и иллюстрацией внутри письма,
-- и документом, который нужно приложить файлом.
CREATE TABLE "campaign_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "file_object_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "position" integer DEFAULT 1 NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "campaign_attachments_kind_check" CHECK ("kind" IN ('PHOTO', 'DOCUMENT')),
  CONSTRAINT "campaign_attachments_position_check" CHECK ("position" BETWEEN 1 AND 20)
);
--> statement-breakpoint

ALTER TABLE "campaign_attachments" ADD CONSTRAINT "campaign_attachments_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Файл нельзя удалить, пока он приложен к рассылке: письмо ссылается на байты.
ALTER TABLE "campaign_attachments" ADD CONSTRAINT "campaign_attachments_file_object_id_file_objects_id_fk" FOREIGN KEY ("file_object_id") REFERENCES "public"."file_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_attachments" ADD CONSTRAINT "campaign_attachments_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Один файл прикладывается к рассылке один раз.
CREATE UNIQUE INDEX "campaign_attachments_file_uidx" ON "campaign_attachments" USING btree ("campaign_id","file_object_id");--> statement-breakpoint
CREATE INDEX "campaign_attachments_campaign_idx" ON "campaign_attachments" USING btree ("campaign_id","position");
