#!/usr/bin/env bash
set -Eeuo pipefail

: "${CRM_DOMAIN:?CRM_DOMAIN is required}"
: "${OIDC_CLIENT_ID:?OIDC_CLIENT_ID is required}"
: "${OIDC_CLIENT_SECRET:?OIDC_CLIENT_SECRET is required}"
: "${CRM_ADMIN_USERNAME:?CRM_ADMIN_USERNAME is required}"
: "${CRM_ADMIN_PASSWORD:?CRM_ADMIN_PASSWORD is required}"
: "${CRM_ADMIN_EMAIL:?CRM_ADMIN_EMAIL is required}"

case "$CRM_DOMAIN" in
  *[!A-Za-z0-9.-]*) echo "CRM_DOMAIN contains unsupported characters" >&2; exit 1 ;;
esac
case "$OIDC_CLIENT_ID" in
  *[!A-Za-z0-9._~-]*) echo "OIDC_CLIENT_ID contains unsupported characters" >&2; exit 1 ;;
esac
case "$OIDC_CLIENT_SECRET" in
  *[!A-Za-z0-9._~-]*) echo "OIDC_CLIENT_SECRET must be URL-safe" >&2; exit 1 ;;
esac
if [ "${#OIDC_CLIENT_SECRET}" -lt 32 ]; then
  echo "OIDC_CLIENT_SECRET must contain at least 32 characters" >&2
  exit 1
fi
case "$CRM_ADMIN_USERNAME" in
  *[!A-Za-z0-9._~-]*) echo "CRM_ADMIN_USERNAME contains unsupported characters" >&2; exit 1 ;;
esac
case "$CRM_ADMIN_PASSWORD" in
  *[!A-Za-z0-9._~-]*) echo "CRM_ADMIN_PASSWORD must be URL-safe" >&2; exit 1 ;;
esac
case "$CRM_ADMIN_EMAIL" in
  *[!A-Za-z0-9@._+-]*) echo "CRM_ADMIN_EMAIL contains unsupported characters" >&2; exit 1 ;;
esac
if [ "${#CRM_ADMIN_PASSWORD}" -lt 20 ]; then
  echo "CRM_ADMIN_PASSWORD must contain at least 20 characters" >&2
  exit 1
fi

mkdir -p /opt/keycloak/data/import
sed \
  -e "s|__CRM_DOMAIN__|${CRM_DOMAIN}|g" \
  -e "s|__OIDC_CLIENT_ID__|${OIDC_CLIENT_ID}|g" \
  -e "s|__OIDC_CLIENT_SECRET__|${OIDC_CLIENT_SECRET}|g" \
  -e "s|__CRM_ADMIN_USERNAME__|${CRM_ADMIN_USERNAME}|g" \
  -e "s|__CRM_ADMIN_PASSWORD__|${CRM_ADMIN_PASSWORD}|g" \
  -e "s|__CRM_ADMIN_EMAIL__|${CRM_ADMIN_EMAIL}|g" \
  /opt/cpi/cpi-crm-realm.json.template \
  > /opt/keycloak/data/import/cpi-crm-realm.json

exec /opt/keycloak/bin/kc.sh "$@"
