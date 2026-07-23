#!/usr/bin/env bash
set -Eeuo pipefail

server_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
env_file=${ENV_FILE:-"$server_dir/.env.server"}
compose_file="$server_dir/docker-compose.yml"
backup_root=${BACKUP_ROOT:-"$server_dir/backups"}
retention_days=${BACKUP_RETENTION_DAYS:-14}

if [ ! -f "$env_file" ]; then
  echo "Missing $env_file" >&2
  exit 1
fi
if ! [[ "$retention_days" =~ ^[0-9]+$ ]] || [ "$retention_days" -lt 1 ]; then
  echo "BACKUP_RETENTION_DAYS must be a positive integer" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$env_file"
set +a

mkdir -p "$backup_root"
backup_root=$(cd -- "$backup_root" && pwd -P)
case "$backup_root" in
  /|/home|/root|/opt|/var) echo "BACKUP_ROOT is too broad: $backup_root" >&2; exit 1 ;;
esac
exec 9>"$backup_root/.backup.lock"
if ! flock -n 9; then
  echo "Another CPI CRM backup is already running" >&2
  exit 1
fi

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$backup_root/$timestamp"
mkdir -m 0700 "$target"
compose=(docker compose --env-file "$env_file" -f "$compose_file")

"${compose[@]}" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$target/crm.dump"
"${compose[@]}" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$KEYCLOAK_DB_NAME" -Fc > "$target/keycloak.dump"

mkdir -m 0700 "$target/minio"
"${compose[@]}" run --rm --no-deps \
  --entrypoint /bin/sh \
  -v "$target/minio:/backup" \
  minio-init -ec '
    mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
    mc mirror --overwrite "local/$S3_QUARANTINE_BUCKET" /backup/quarantine
    mc mirror --overwrite "local/$S3_PRIVATE_BUCKET" /backup/private
  '

(
  cd "$target"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
)

# Only timestamp-shaped directories directly under the validated backup root
# are eligible for retention cleanup.
find "$backup_root" -mindepth 1 -maxdepth 1 -type d \
  -name '20??????T??????Z' -mtime "+$retention_days" -prune -exec find {} -depth -delete \;

echo "Backup completed: $target"
