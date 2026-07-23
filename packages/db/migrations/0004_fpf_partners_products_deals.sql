-- FPF rework: the CRM is built around three key entities (people, partners, products)
-- plus the revenue pipeline (deals) and the role model from the FPF plan.
CREATE TYPE "public"."partner_kind" AS ENUM('COMMERCIAL', 'GRANT_FUND', 'UNIVERSITY', 'GOVERNMENT', 'MEDIA', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."partner_status" AS ENUM('PROSPECT', 'DEVELOPING', 'ACTIVE', 'PAUSED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."partner_agreement_type" AS ENUM('GRANT', 'COMMERCIAL', 'PARTNERSHIP', 'INFO_PARTNERSHIP');--> statement-breakpoint
CREATE TYPE "public"."partner_agreement_status" AS ENUM('DRAFT', 'NEGOTIATION', 'ACTIVE', 'COMPLETED', 'TERMINATED');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('IDEA', 'PACKAGING', 'ON_SALE', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."deal_type" AS ENUM('GRANT', 'COMMERCIAL');--> statement-breakpoint
CREATE TYPE "public"."deal_status" AS ENUM('LEAD', 'NEGOTIATION', 'WON', 'LOST');--> statement-breakpoint

CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"kind" "partner_kind" DEFAULT 'OTHER' NOT NULL,
	"status" "partner_status" DEFAULT 'PROSPECT' NOT NULL,
	"inn" text,
	"website" text,
	"notes" text,
	"owner_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"position" text,
	"is_decision_maker" boolean DEFAULT false NOT NULL,
	"email" text,
	"phone" text,
	"telegram" text,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"agreement_type" "partner_agreement_type" NOT NULL,
	"status" "partner_agreement_status" DEFAULT 'DRAFT' NOT NULL,
	"amount" numeric(14, 2),
	"signed_at" timestamp with time zone,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"comment" text,
	"owner_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_agreements_amount_check" CHECK ("partner_agreements"."amount" is null or "partner_agreements"."amount" >= 0),
	CONSTRAINT "partner_agreements_period_check" CHECK ("partner_agreements"."ends_at" is null or "partner_agreements"."starts_at" is null or "partner_agreements"."ends_at" > "partner_agreements"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "partner_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"contact_id" uuid,
	"channel" "interaction_channel" NOT NULL,
	"direction" "interaction_direction" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"outcome" text,
	"comment" text,
	"created_by_user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"description" text,
	"delivery_model" text,
	"documentation_url" text,
	"status" "product_status" DEFAULT 'IDEA' NOT NULL,
	"price" numeric(14, 2),
	"owner_user_id" uuid,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_price_check" CHECK ("products"."price" is null or "products"."price" >= 0),
	CONSTRAINT "products_closed_fields_check" CHECK ("products"."status" <> 'CLOSED' or ("products"."closed_at" is not null and "products"."close_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"partner_id" uuid,
	"agreement_id" uuid,
	"product_id" uuid,
	"project_id" uuid,
	"title" text NOT NULL,
	"deal_type" "deal_type" NOT NULL,
	"status" "deal_status" DEFAULT 'LEAD' NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'RUB' NOT NULL,
	"expected_close_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"comment" text,
	"owner_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deals_amount_check" CHECK ("deals"."amount" >= 0),
	CONSTRAINT "deals_closed_fields_check" CHECK ("deals"."status" in ('LEAD', 'NEGOTIATION') or "deals"."closed_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_owner_user_id_app_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_contacts" ADD CONSTRAINT "partner_contacts_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_agreements" ADD CONSTRAINT "partner_agreements_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_agreements" ADD CONSTRAINT "partner_agreements_owner_user_id_app_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_interactions" ADD CONSTRAINT "partner_interactions_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_interactions" ADD CONSTRAINT "partner_interactions_contact_id_partner_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."partner_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_interactions" ADD CONSTRAINT "partner_interactions_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_owner_user_id_app_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_agreement_id_partner_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."partner_agreements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_owner_user_id_app_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partners_organization_idx" ON "partners" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_org_normalized_name_uidx" ON "partners" USING btree ("organization_id","normalized_name") WHERE "partners"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "partners_status_idx" ON "partners" USING btree ("status");--> statement-breakpoint
CREATE INDEX "partner_contacts_partner_idx" ON "partner_contacts" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "partner_agreements_partner_idx" ON "partner_agreements" USING btree ("partner_id","status");--> statement-breakpoint
CREATE INDEX "partner_interactions_timeline_idx" ON "partner_interactions" USING btree ("partner_id","occurred_at");--> statement-breakpoint
CREATE INDEX "products_organization_idx" ON "products" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_org_normalized_name_uidx" ON "products" USING btree ("organization_id","normalized_name") WHERE "products"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "deals_organization_idx" ON "deals" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "deals_partner_idx" ON "deals" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "deals_pipeline_idx" ON "deals" USING btree ("status","closed_at");--> statement-breakpoint

INSERT INTO permissions (code, description)
VALUES
  ('events.write', 'Создание и изменение мероприятий'),
  ('partners.read', 'Просмотр базы партнёров'),
  ('partners.write', 'Изменение партнёров, ЛПР, соглашений и взаимодействий'),
  ('products.read', 'Просмотр базы продуктов'),
  ('products.write', 'Создание, изменение и закрытие продуктов'),
  ('deals.read', 'Просмотр сделок и выручки'),
  ('deals.write', 'Ведение сделок (гранты и коммерция)'),
  ('metrics.read', 'Просмотр процессных метрик FPF')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

INSERT INTO roles (code, name, description, is_system)
VALUES
  ('leader', 'Руководитель СС', 'Стратегия, контроль выручки и метрик', true),
  ('event_manager', 'Ивент-менеджер', 'Мероприятия: препродакшн, проведение, постпродакшн', true),
  ('partner_manager', 'Менеджер по партнёрке и продажам', 'Партнёры, соглашения, сделки: гранты и коммерция', true),
  ('back_office', 'Менеджер по операционке', 'Документооборот, заявки и оргсопровождение', true),
  ('smm_manager', 'SMM-менеджер', 'Информационная политика и охваты', true),
  ('product_manager', 'Менеджер по продукту', 'Формирование и документирование продуктов', true)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = ANY (ARRAY[
  'people.read', 'contacts.read', 'artifacts.read', 'partners.read', 'products.read',
  'deals.read', 'metrics.read', 'audit.read', 'exports.bulk', 'settings.manage'
])
WHERE r.code = 'leader'
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = ANY (ARRAY[
  'people.read', 'contacts.read', 'events.write', 'artifacts.read', 'artifacts.write',
  'tasks.manage', 'metrics.read'
])
WHERE r.code = 'event_manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = ANY (ARRAY[
  'people.read', 'partners.read', 'partners.write', 'deals.read', 'deals.write',
  'products.read', 'tasks.manage', 'metrics.read'
])
WHERE r.code = 'partner_manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = ANY (ARRAY[
  'people.read', 'contacts.read', 'partners.read', 'deals.read', 'tasks.manage',
  'audit.read', 'exports.bulk'
])
WHERE r.code = 'back_office'
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = ANY (ARRAY['people.read', 'metrics.read'])
WHERE r.code = 'smm_manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = ANY (ARRAY[
  'people.read', 'artifacts.read', 'products.read', 'products.write', 'deals.read', 'metrics.read'
])
WHERE r.code = 'product_manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'metrics.read'
WHERE r.code IN ('community_manager', 'methodologist')
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
-- Align the pre-existing DB role catalog with the domain matrix in
-- packages/domain/src/permissions.ts: events.write existed only in code, and
-- data_steward lacked contacts.write, artifacts.read, and exports.bulk.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'events.write'
WHERE r.code = 'community_manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = ANY (ARRAY['contacts.write', 'artifacts.read', 'exports.bulk'])
WHERE r.code = 'data_steward'
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = ANY (ARRAY['partners.read', 'products.read', 'deals.read', 'metrics.read'])
WHERE r.code = 'auditor'
ON CONFLICT (role_id, permission_id) DO NOTHING;
