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
required='DB_PASSWORD RABBITMQ_PASSWORD JWT_SECRET JWT_REFRESH_SECRET INTEGRATION_CREDENTIAL_SECRET MINIO_SECRET_KEY CORS_ORIGINS ELCHI_PARTNER_API_URL ELCHI_PARTNER_API_KEY'
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

# TRUST_PROXY_HOPS haqiqiy proxy zanjiriga teng bo'lishi SHART (C4.8).
# Kam bo'lsa audit jurnaliga proksining ichki IP'si tushadi va rate limit
# hamma foydalanuvchini bitta IP deb sanaydi; ko'p bo'lsa mijoz
# `X-Forwarded-For` ni o'zi to'qib, jurnalga soxta IP yozdira oladi.
# Shuning uchun bu yerda ogohlantirish emas, QAT'IY tekshiruv turadi —
# 2026-09-17 da aynan shu qiymat jimgina 1 bo'lib qolgani uchun butun audit
# jurnali foydasiz bo'lgan edi. Batafsil: docs/C4.8-TRUST-PROXY.md
# Skriptning qolgan qismi kabi: fayl bo'sh qolsa export qilingan qiymat olinadi
# (CI deploy job'i bir qism kalitlarni env orqali uzatadi).
trust_hops=$(sed -n 's/^TRUST_PROXY_HOPS=//p' "$env_file" | tail -n 1)
trust_hops=${trust_hops:-${TRUST_PROXY_HOPS:-}}
compose_profiles=$(sed -n 's/^COMPOSE_PROFILES=//p' "$env_file" | tail -n 1)
compose_profiles=${compose_profiles:-${COMPOSE_PROFILES:-}}
case ",${compose_profiles}," in
  *,tunnel,*) expected_hops=2 ;;  # cloudflared -> caddy -> api-gateway
  *) expected_hops=1 ;;           # caddy -> api-gateway
esac
if [ -z "${trust_hops:-}" ]; then
  printf 'TRUST_PROXY_HOPS berilmagan — sukut qiymati 1, zanjir esa %s bosqichli.\n' "$expected_hops" >&2
  printf '  %s ga qo‘shing: TRUST_PROXY_HOPS=%s\n' "$env_file" "$expected_hops" >&2
  exit 1
fi
if [ "$trust_hops" != "$expected_hops" ]; then
  printf 'TRUST_PROXY_HOPS=%s, lekin proxy zanjiri %s bosqichli (COMPOSE_PROFILES=%s).\n' \
    "$trust_hops" "$expected_hops" "${compose_profiles:-<bo‘sh>}" >&2
  printf '  Zanjir ataylab o‘zgargan bo‘lsa shu skriptdagi kutilgan qiymatni ham yangilang.\n' >&2
  exit 1
fi

printf 'Production env audit muvaffaqiyatli: %s\n' "$env_file"
