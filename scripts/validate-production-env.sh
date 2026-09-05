#!/bin/sh
set -eu

env_file=${1:-.env.production}
test -f "$env_file"

if grep -Eq '=(REPLACE_WITH|change-me|changeme|example\.com)' "$env_file"; then
  printf 'Production env ichida placeholder qiymat bor: %s\n' "$env_file" >&2
  exit 1
fi

# DOMAIN va TLS_EMAIL server faylidan yoki deploy jarayonida export qilingan
# qiymatdan kelishi mumkin. Ikkalasi ham bo'sh qolsa Caddyfile parse bo'lmaydi.
# APP_DOMAIN (sotuvchi kabineti) ixtiyoriy: berilmasa compose xavfsiz
# `.localhost` zaxirasini qo'yadi va faqat ogohlantirish chiqadi.
required='DB_PASSWORD RABBITMQ_PASSWORD JWT_SECRET JWT_REFRESH_SECRET INTEGRATION_CREDENTIAL_SECRET MINIO_SECRET_KEY CORS_ORIGINS'
for key in $required; do
  value=$(sed -n "s/^${key}=//p" "$env_file" | tail -n 1)
  if [ -z "$value" ]; then
    eval "value=\${${key}:-}"
  fi
  if [ -z "$value" ]; then
    printf 'Production env qiymati yo‘q: %s\n' "$key" >&2
    exit 1
  fi
done

# RATE_LIMIT_* berilmasa backend production uchun xavfsiz defaultlardan
# foydalanadi: 100 request / 60 soniya. Eski production env deployini buzmaydi.
rate_limit_max=$(sed -n 's/^RATE_LIMIT_MAX=//p' "$env_file" | tail -n 1)
rate_limit_window=$(sed -n 's/^RATE_LIMIT_WINDOW_MS=//p' "$env_file" | tail -n 1)
rate_limit_max=${rate_limit_max:-100}
rate_limit_window=${rate_limit_window:-60000}
case "$rate_limit_max:$rate_limit_window" in
  *[!0-9:]*|:*)
    printf 'RATE_LIMIT_MAX/RATE_LIMIT_WINDOW_MS musbat son bo‘lishi kerak\n' >&2
    exit 1
    ;;
esac
[ "$rate_limit_max" -gt 0 ] && [ "$rate_limit_window" -ge 1000 ] || {
  printf 'Rate-limit qiymatlari noto‘g‘ri\n' >&2
  exit 1
}

domain=$(sed -n 's/^DOMAIN=//p' "$env_file" | tail -n 1)
if [ -z "${domain:-}" ] || [ "${domain#:}" != "$domain" ]; then
  printf 'OGOHLANTIRISH: DOMAIN yo‘q yoki HTTP rejimi — API sertifikatsiz, IP orqali ochiladi.\n' >&2
  printf '  Production uchun .env.production ga DOMAIN va TLS_EMAIL qo‘shing.\n' >&2
fi

printf 'Production env audit muvaffaqiyatli: %s\n' "$env_file"
