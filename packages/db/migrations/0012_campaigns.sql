CREATE TYPE "campaign_channel" AS ENUM('TELEGRAM', 'EMAIL');--> statement-breakpoint
CREATE TYPE "campaign_status" AS ENUM('DRAFT', 'APPROVED', 'SENDING', 'PAUSED', 'SENT', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "campaign_recipient_status" AS ENUM('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "campaign_reply" AS ENUM('INTERESTED', 'MORE_INFO', 'UNSUBSCRIBED');--> statement-breakpoint

-- Кампания хранит и текст, и правила отбора: письмо правится до утверждения,
-- после утверждения меняется только ход отправки.
CREATE TABLE "campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" text NOT NULL,
  "channel" "campaign_channel" NOT NULL,
  "status" "campaign_status" DEFAULT 'DRAFT' NOT NULL,
  "goal" text,
  "subject" text,
  "body" text NOT NULL,
  "buttons" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "segment" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "wave_size" integer DEFAULT 200 NOT NULL,
  "messages_per_second" integer DEFAULT 20 NOT NULL,
  "sent_count" integer DEFAULT 0 NOT NULL,
  "failed_count" integer DEFAULT 0 NOT NULL,
  "approved_by_user_id" uuid,
  "approved_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  "version" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "campaigns_body_check" CHECK (length(btrim("body")) > 0),
  CONSTRAINT "campaigns_wave_check" CHECK ("wave_size" BETWEEN 1 AND 5000),
  CONSTRAINT "campaigns_rate_check" CHECK ("messages_per_second" BETWEEN 1 AND 25),
  -- У письма обязательна тема, у сообщения в бот её не бывает.
  CONSTRAINT "campaigns_subject_check" CHECK ("channel" <> 'EMAIL' OR "subject" IS NOT NULL),
  CONSTRAINT "campaigns_approval_check"
    CHECK ("status" IN ('DRAFT', 'CANCELLED') OR "approved_at" IS NOT NULL)
);
--> statement-breakpoint

CREATE TABLE "campaign_recipients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "person_id" uuid NOT NULL,
  "address" text NOT NULL,
  "wave" integer DEFAULT 1 NOT NULL,
  "status" "campaign_recipient_status" DEFAULT 'QUEUED' NOT NULL,
  "reply" "campaign_reply",
  "replied_at" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "error" text,
  "external_message_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "campaign_recipients_sent_check"
    CHECK ("status" NOT IN ('SENT', 'DELIVERED') OR "sent_at" IS NOT NULL)
);
--> statement-breakpoint

CREATE TABLE "campaign_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "recipient_id" uuid NOT NULL,
  "type" text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "external_event_id" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "campaign_events_type_check"
    CHECK ("type" IN ('SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'REPLIED',
                      'UNSUBSCRIBED', 'BOUNCED', 'SPAM', 'FAILED'))
);
--> statement-breakpoint

ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_approved_by_user_id_app_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_events" ADD CONSTRAINT "campaign_events_recipient_id_campaign_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."campaign_recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status","created_at");--> statement-breakpoint
-- Один человек в кампании ровно один раз: защита от двойной отправки.
CREATE UNIQUE INDEX "campaign_recipients_person_uidx" ON "campaign_recipients" USING btree ("campaign_id","person_id");--> statement-breakpoint
CREATE INDEX "campaign_recipients_queue_idx" ON "campaign_recipients" USING btree ("campaign_id","status","wave");--> statement-breakpoint
CREATE INDEX "campaign_events_recipient_idx" ON "campaign_events" USING btree ("recipient_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_events_external_uidx" ON "campaign_events" USING btree ("external_event_id") WHERE "external_event_id" IS NOT NULL;--> statement-breakpoint

INSERT INTO permissions (code, description)
VALUES
  ('campaigns.read', 'Просмотр рассылок и их статистики'),
  ('campaigns.write', 'Создание и редактирование рассылок'),
  ('campaigns.send', 'Утверждение и запуск рассылок')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin' AND p.code IN ('campaigns.read', 'campaigns.write', 'campaigns.send')
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('campaigns.read', 'campaigns.write', 'campaigns.send')
WHERE r.code = 'leader'
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('campaigns.read', 'campaigns.write')
WHERE r.code IN ('community_manager', 'smm_manager')
ON CONFLICT (role_id, permission_id) DO NOTHING;
