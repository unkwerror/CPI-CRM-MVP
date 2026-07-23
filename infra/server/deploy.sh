#!/usr/bin/env bash
set -Eeuo pipefail

server_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
env_file=${ENV_FILE:-"$server_dir/.env.server"}
compose_file="$server_dir/docker-compose.yml"
run_import=false
check_only=false

if [ "${1:-}" = "--import" ]; then
  run_import=true
elif [ "${1:-}" = "--check" ]; then
  check_only=true
elif [ "$#" -gt 0 ]; then
  echo "Usage: $0 [--check|--import]" >&2
  exit 2
fi

if [ ! -f "$env_file" ]; then
  echo "Missing $env_file; copy .env.server.example and fill every secret." >&2
  exit 1
fi
env_mode=$(stat -c '%a' "$env_file")
if [ "$env_mode" != 600 ] && [ "$env_mode" != 400 ]; then
  echo "$env_file must be readable only by its owner (chmod 600)." >&2
  exit 1
fi
if grep -Eq '(^|=)CHANGE_ME|CHANGE_ME_' "$env_file"; then
  echo "Refusing deployment: $env_file still contains CHANGE_ME values." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$env_file"
set +a
required_variables=(
  CRM_DOMAIN ID_DOMAIN S3_DOMAIN ACME_EMAIL
  POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD APP_DB_USER APP_DB_PASSWORD
  KEYCLOAK_DB_NAME KEYCLOAK_DB_USER KEYCLOAK_DB_PASSWORD
  KEYCLOAK_ADMIN_USERNAME KEYCLOAK_ADMIN_PASSWORD
  CRM_ADMIN_USERNAME CRM_ADMIN_PASSWORD CRM_ADMIN_EMAIL
  OIDC_CLIENT_ID OIDC_CLIENT_SECRET SESSION_KEY_BASE64
  MINIO_ROOT_USER MINIO_ROOT_PASSWORD S3_APP_USER S3_APP_PASSWORD
)
for variable_name in "${required_variables[@]}"; do
  if [ -z "${!variable_name:-}" ]; then
    echo "Missing required value: $variable_name" >&2
    exit 1
  fi
done
for variable_name in POSTGRES_PASSWORD APP_DB_PASSWORD OIDC_CLIENT_SECRET; do
  if [[ "${!variable_name}" == *[^A-Za-z0-9._~-]* ]]; then
    echo "$variable_name must be URL-safe (hex is recommended)" >&2
    exit 1
  fi
done
if ! session_key_bytes=$(printf '%s' "$SESSION_KEY_BASE64" | base64 -d 2>/dev/null | wc -c); then
  echo "SESSION_KEY_BASE64 is not valid base64" >&2
  exit 1
fi
if [ "$session_key_bytes" -ne 32 ]; then
  echo "SESSION_KEY_BASE64 must decode to exactly 32 bytes" >&2
  exit 1
fi
workbook_path=${IMPORT_WORKBOOK_HOST:-../../Участники_всех_мероприятий_Стартап_студии_ЯДРО1.xlsx}
if [[ "$workbook_path" != /* ]]; then
  workbook_path="$server_dir/$workbook_path"
fi
if [ ! -f "$workbook_path" ]; then
  echo "Workbook does not exist: $workbook_path" >&2
  exit 1
fi
swap_kib=$(awk '/^SwapTotal:/ { print $2 }' /proc/meminfo)
if [ "${swap_kib:-0}" -lt 2000000 ]; then
  echo "At least 2 GiB swap is required for safe ClamAV signature reloads." >&2
  exit 1
fi

compose=(docker compose --env-file "$env_file" -f "$compose_file")
"${compose[@]}" config --quiet
if "$check_only"; then
  echo "Production deployment configuration is valid."
  exit 0
fi

# Build each unique image once. The seed and ops importer intentionally reuse
# the API image; asking Compose to build every service can race while exporting
# the same tag through BuildKit.
export COMPOSE_PARALLEL_LIMIT=${COMPOSE_PARALLEL_LIMIT:-1}
"${compose[@]}" build api worker web migrate
"${compose[@]}" up -d --wait --wait-timeout 600

if "$run_import"; then
  "${compose[@]}" --profile ops run --rm --no-deps import-workbook
fi

"${compose[@]}" ps
