#!/usr/bin/env bash
set -euo pipefail

crm_root_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$crm_root_dir"

crm_workbook="$crm_root_dir/Участники_всех_мероприятий_Стартап_студии_ЯДРО1.xlsx"
crm_local_database_url="postgresql://cpi_crm:cpi_crm_local@localhost:5433/cpi_crm"
crm_compose=(docker compose -f infra/docker-compose.yml)

crm_fail() {
  echo "Ошибка локального запуска: $*" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || crm_fail "не найден Node.js 22+."
crm_node_major=$(node -p "Number(process.versions.node.split('.')[0])")
if [ "$crm_node_major" -lt 22 ]; then
  crm_fail "нужен Node.js 22+, найден $(node --version)."
fi

command -v corepack >/dev/null 2>&1 || crm_fail "не найден Corepack."
corepack pnpm --version >/dev/null 2>&1 || crm_fail "Corepack не смог запустить pnpm."
command -v docker >/dev/null 2>&1 || crm_fail "не найден Docker."
docker compose version >/dev/null 2>&1 || crm_fail "не найден Docker Compose v2."
crm_compose_up_help=$(docker compose up --help)
grep -q -- '--wait' <<<"$crm_compose_up_help" || crm_fail "Docker Compose не поддерживает --wait."
docker info >/dev/null 2>&1 || crm_fail "Docker daemon недоступен; проверьте, что он запущен и пользователь имеет доступ к Docker socket."
"${crm_compose[@]}" config --quiet || crm_fail "infra/docker-compose.yml невалиден."
[ -r "$crm_workbook" ] || crm_fail "не найдена исходная книга: $crm_workbook"

corepack pnpm install
"${crm_compose[@]}" up -d --wait --wait-timeout 720 postgres redis minio keycloak clamav
"${crm_compose[@]}" run --rm --no-deps minio-init

corepack pnpm --filter @cpi-crm/domain build
corepack pnpm --filter @cpi-crm/db build
corepack pnpm --filter @cpi-crm/contracts build
corepack pnpm --filter @cpi-crm/importer build
DATABASE_URL="$crm_local_database_url" corepack pnpm run db:migrate
DATABASE_URL="$crm_local_database_url" corepack pnpm run db:seed

crm_org_id=$("${crm_compose[@]}" exec -T postgres \
  psql -U cpi_crm -d cpi_crm -Atc "select id from organizations where external_id = 'cpi-primary' limit 1")
crm_import_user_id=$("${crm_compose[@]}" exec -T postgres \
  psql -U cpi_crm -d cpi_crm -Atc "select id from app_users where oidc_subject = 'local-importer' limit 1")
[ -n "$crm_org_id" ] || crm_fail "seed не создал организацию cpi-primary."
[ -n "$crm_import_user_id" ] || crm_fail "seed не создал пользователя local-importer."

corepack pnpm run import:workbook -- \
  --commit \
  --file "$crm_workbook" \
  --database-url "$crm_local_database_url" \
  --organization-id "$crm_org_id" \
  --user-id "$crm_import_user_id" \
  --report-dir "$crm_root_dir/import-reports/latest"

echo "Локальный контур подготовлен. Запуск приложения: corepack pnpm dev"
