#!/usr/bin/env bash
set -Eeuo pipefail

: "${KEYCLOAK_DB_NAME:?KEYCLOAK_DB_NAME is required}"
: "${KEYCLOAK_DB_USER:?KEYCLOAK_DB_USER is required}"
: "${KEYCLOAK_DB_PASSWORD:?KEYCLOAK_DB_PASSWORD is required}"
: "${APP_DB_USER:?APP_DB_USER is required}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}"

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_database="$POSTGRES_DB" \
  --set=owner_user="$POSTGRES_USER" \
  --set=app_user="$APP_DB_USER" \
  --set=app_password="$APP_DB_PASSWORD" \
  --set=kc_database="$KEYCLOAK_DB_NAME" \
  --set=kc_user="$KEYCLOAK_DB_USER" \
  --set=kc_password="$KEYCLOAK_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'app_user') \gexec
SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', :'app_database') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'app_database', :'app_user') \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_user') \gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', :'app_user') \gexec
SELECT format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO %I', :'app_user') \gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
  :'owner_user', :'app_user'
) \gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I',
  :'owner_user', :'app_user'
) \gexec

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'kc_user', :'kc_password')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'kc_user') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'kc_database', :'kc_user')
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'kc_database') \gexec
SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', :'kc_database') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'kc_database', :'kc_user') \gexec
SQL
