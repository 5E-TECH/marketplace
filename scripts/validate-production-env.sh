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

# BE-36: servis DB rollari. Bitta DB_USERNAME_<SXEMA> berilsa — hamma 10 servisning roli va paroli kerak, boshqa
# nom (xato yozilgan kalit) bo'lmasin: aks holda servis ishga tushmaydi (typeorm.util dbCredentials).
if grep -Eq '^DB_USERNAME_[A-Z_]+=.+' "$env_file"; then
  schemas='IDENTITY CATALOG INVENTORY CHECKOUT PAYMENT FINANCE INTEGRATION NOTIFICATION SEARCH LEAD'
  for schema in $schemas; do
    for key in "DB_USERNAME_$schema" "DB_PASSWORD_$schema"; do
      value=$(sed -n "s/^${key}=//p" "$env_file" | tail -n 1)
      if [ -z "$value" ]; then
        printf 'Servis DB rollari yoqilgan, lekin qiymat yo‘q: %s (docs/BE-36-KOP-NUSXA.md)\n' "$key" >&2
        exit 1
      fi
    done
  done
  for key in $(sed -n 's/^\(DB_USERNAME_[A-Z_]*\)=.*/\1/p' "$env_file"); do
    case " $schemas " in
      *" ${key#DB_USERNAME_} "*) ;;
      *)
        printf 'Noma’lum servis DB roli kaliti: %s (sxemalar: %s)\n' "$key" "$schemas" >&2
        exit 1
        ;;
    esac
  done
fi

domain=$(sed -n 's/^DOMAIN=//p' "$env_file" | tail -n 1)
if [ -z "${domain:-}" ] || [ "${domain#:}" != "$domain" ]; then
  printf 'OGOHLANTIRISH: DOMAIN yo‘q yoki HTTP rejimi — API sertifikatsiz, IP orqali ochiladi.\n' >&2
  printf '  Production uchun .env.production ga DOMAIN va TLS_EMAIL qo‘shing.\n' >&2
fi

# TRUST_PROXY_HOPS endi o'qilmaydi (C4.8, 2026-10-03): api-gateway ishonchli
# proksilarni bosqichlar soni bo'yicha emas, ichki tarmoq bo'yicha aniqlaydi —
# storefront proksisi qo'shgan uzunroq zanjirga bitta raqam to'g'ri kelmasdi.
# Qolgan qiymat zararsiz, faqat chalg'itmasligi uchun eslatamiz.
if grep -q '^TRUST_PROXY_HOPS=' "$env_file"; then
  printf 'OGOHLANTIRISH: TRUST_PROXY_HOPS endi ishlatilmaydi — %s dan olib tashlang.\n' "$env_file" >&2
  printf '  Batafsil: docs/C4.8-TRUST-PROXY.md\n' >&2
fi

# Tokenlar body'da qaytsa XSS ularni `POST /auth/refresh` orqali o'qib olishi
# mumkin (API_CONTRACT §2.2.1). Deploy'ni to'xtatmaymiz: frontendlar cookie
# rejimiga tayyor bo'lmaguncha true qolishi to'g'ri, faqat unutilmasin.
auth_in_body=$(sed -n 's/^AUTH_TOKENS_IN_BODY=//p' "$env_file" | tail -n 1)
auth_in_body=${auth_in_body:-${AUTH_TOKENS_IN_BODY:-true}}
if [ "$auth_in_body" != "false" ]; then
  printf 'OGOHLANTIRISH: AUTH_TOKENS_IN_BODY=%s — tokenlar body‘da ham qaytadi.\n' "$auth_in_body" >&2
  printf '  Frontendlar cookie rejimiga o‘tgach false qiling (docs/API_CONTRACT.md §2.2.1).\n' >&2
fi

printf 'Production env audit muvaffaqiyatli: %s\n' "$env_file"
