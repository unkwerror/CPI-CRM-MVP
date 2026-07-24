-- ЦПИ: метрики и формулы. Расходы с привязкой, оплата сделок «по факту»,
-- рубрикатор качества артефакта (5 критериев 0–2) и связь сделки с головой.

CREATE TYPE expense_category AS ENUM (
  'VARIABLE',      -- переменные затраты конкретной сделки/мероприятия
  'OPEX',          -- операционные расходы на содержание системы
  'BACK_OFFICE',   -- документы, заявки, бюджеты, сопровождение
  'ACQUISITION',   -- расходы на привлечение новых строк в базу
  'ACTIVATION'     -- трекинг, эксперты, активационные сессии
);
--> statement-breakpoint

CREATE TABLE expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  category expense_category NOT NULL,
  amount numeric(14, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'RUB',
  occurred_at timestamptz NOT NULL,
  description text NOT NULL,
  event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  owner_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT expenses_amount_check CHECK (amount > 0)
);
--> statement-breakpoint
CREATE INDEX expenses_organization_idx ON expenses (organization_id);
--> statement-breakpoint
CREATE INDEX expenses_period_idx ON expenses (occurred_at);
--> statement-breakpoint
CREATE INDEX expenses_category_idx ON expenses (category);
--> statement-breakpoint

-- Выручку считаем по факту оплаты: у сделки появляется дата и сумма оплаты.
ALTER TABLE deals ADD COLUMN paid_at timestamptz;
--> statement-breakpoint
ALTER TABLE deals ADD COLUMN paid_amount numeric(14, 2);
--> statement-breakpoint
ALTER TABLE deals ADD CONSTRAINT deals_paid_pair_check
  CHECK ((paid_at IS NULL) = (paid_amount IS NULL));
--> statement-breakpoint
ALTER TABLE deals ADD CONSTRAINT deals_paid_amount_check
  CHECK (paid_amount IS NULL OR paid_amount >= 0);
--> statement-breakpoint
CREATE INDEX deals_paid_idx ON deals (paid_at) WHERE paid_at IS NOT NULL;
--> statement-breakpoint

-- Продажа компетенций и «голов»: сделка может ссылаться на участника.
ALTER TABLE deals ADD COLUMN person_id uuid REFERENCES persons(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX deals_person_idx ON deals (person_id) WHERE person_id IS NOT NULL;
--> statement-breakpoint

-- Рубрикатор качества: 5 критериев по 0–2, Q_artifact = сумма (0–10).
-- Старые ревью остаются с единым баллом (criteria IS NULL).
ALTER TABLE artifact_reviews ADD COLUMN criteria jsonb;
--> statement-breakpoint
ALTER TABLE artifact_reviews DROP CONSTRAINT artifact_reviews_score_check;
--> statement-breakpoint
ALTER TABLE artifact_reviews ADD CONSTRAINT artifact_reviews_score_check
  CHECK (score IS NULL OR (score BETWEEN 0 AND 10));
--> statement-breakpoint

INSERT INTO permissions (code, description)
VALUES
  ('expenses.read', 'Просмотр расходов'),
  ('expenses.write', 'Ведение расходов (переменные, операционные, привлечение, активация)')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin' AND p.code IN ('expenses.read', 'expenses.write')
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('expenses.read', 'expenses.write')
WHERE r.code IN ('leader', 'back_office')
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'expenses.read'
WHERE r.code IN ('event_manager', 'partner_manager', 'product_manager', 'smm_manager')
ON CONFLICT (role_id, permission_id) DO NOTHING;
