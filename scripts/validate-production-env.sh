#!/bin/sh
set -eu

env_file=${1:-.env.production}
test -f "$env_file"

if grep -Eq '=(REPLACE_WITH|change-me|changeme|example\.com)' "$env_file"; then
  printf 'Production env ichida placeholder qiymat bor: %s\n' "$env_file" >&2
  exit 1
fi

# DOMAIN/APP_DOMAIN/TLS_EMAIL bo'lmasa Caddy konfiguratsiyasi parse bo'lmaydi
# va TLS bilan birga API ham yiqiladi — shuning uchun ular ham majburiy.
required='DB_PASSWORD RABBITMQ_PASSWORD JWT_SECRET JWT_REFRESH_SECRET INTEGRATION_CREDENTIAL_SECRET MINIO_SECRET_KEY CORS_ORIGINS RATE_LIMIT_MAX DOMAIN APP_DOMAIN TLS_EMAIL'
for key in $required; do
  value=$(sed -n "s/^${key}=//p" "$env_file" | tail -n 1)
  if [ -z "$value" ]; then
    printf 'Production env qiymati yo‘q: %s\n' "$key" >&2
    exit 1
  fi
done

printf 'Production env audit muvaffaqiyatli: %s\n' "$env_file"
