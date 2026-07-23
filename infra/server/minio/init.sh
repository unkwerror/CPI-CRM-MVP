#!/bin/sh
set -eu

: "${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"
: "${S3_APP_USER:?S3_APP_USER is required}"
: "${S3_APP_PASSWORD:?S3_APP_PASSWORD is required}"
: "${S3_QUARANTINE_BUCKET:?S3_QUARANTINE_BUCKET is required}"
: "${S3_PRIVATE_BUCKET:?S3_PRIVATE_BUCKET is required}"

case "$S3_QUARANTINE_BUCKET$S3_PRIVATE_BUCKET" in
  *[!A-Za-z0-9.-]*) echo "S3 bucket name contains unsupported characters" >&2; exit 1 ;;
esac

mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc mb --ignore-existing "local/$S3_QUARANTINE_BUCKET"
mc mb --ignore-existing "local/$S3_PRIVATE_BUCKET"
mc anonymous set none "local/$S3_QUARANTINE_BUCKET"
mc anonymous set none "local/$S3_PRIVATE_BUCKET"

printf '%s\n' \
  '{' \
  '  "Version": "2012-10-17",' \
  '  "Statement": [' \
  '    {' \
  '      "Effect": "Allow",' \
  '      "Action": ["s3:GetBucketLocation", "s3:ListBucket"],' \
  "      \"Resource\": [\"arn:aws:s3:::$S3_QUARANTINE_BUCKET\", \"arn:aws:s3:::$S3_PRIVATE_BUCKET\"]" \
  '    },' \
  '    {' \
  '      "Effect": "Allow",' \
  '      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],' \
  "      \"Resource\": [\"arn:aws:s3:::$S3_QUARANTINE_BUCKET/*\", \"arn:aws:s3:::$S3_PRIVATE_BUCKET/*\"]" \
  '    }' \
  '  ]' \
  '}' > /tmp/policy.json
if ! mc admin user info local "$S3_APP_USER" >/dev/null 2>&1; then
  mc admin user add local "$S3_APP_USER" "$S3_APP_PASSWORD"
fi
if ! mc admin policy info local cpi-crm-app >/dev/null 2>&1; then
  mc admin policy create local cpi-crm-app /tmp/policy.json
fi
mc admin policy attach local cpi-crm-app --user "$S3_APP_USER"
