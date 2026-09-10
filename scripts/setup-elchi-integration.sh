#!/bin/sh
# =============================================================================
# Elchi <-> Marketplace integratsiyasini sozlaydi (C1.40).
#
# NEGA KERAK: 2026-09-10 da aniqlandiki productionda bu bog'lanish umuman
# ulanmagan ekan — Elchi'da birorta partner yozuvi yo'q va marketplace
# `.env.production` da ELCHI_* kalitlarining birortasi ham qo'yilmagan.
# Natijada:
#   - POST /checkout/delivery-preview  -> 500  (ELCHI_PARTNER_API_URL yo'q)
#   - POST /webhooks/elchi             -> 401  (ELCHI_WEBHOOK_SECRET yo'q)
# Ya'ni dostavka narxi ko'rinmaydi va Elchi buyurtma statusini qaytara olmaydi.
#
# NEGA QO'LDA: hamkor yaratish Elchi tomonida SUPERADMIN JWT talab qiladi
# (kalit sha256 bilan hash qilinadi, webhook sekret AES bilan shifrlanadi va
# har amal activity-log'ga tushadi). Bazaga to'g'ridan-to'g'ri yozish bu
# mantiqni chetlab o'tardi.
#
# ISHLATISH:
#   ELCHI_ADMIN_TOKEN='<SUPERADMIN JWT>' sh scripts/setup-elchi-integration.sh
#
# Tokenni olish:
#   curl -s -X POST https://api.elchipochta.uz/auth/login \
#     -H 'Content-Type: application/json' \
#     -d '{"phone":"+998...","password":"..."}' | grep -o '"accessToken":"[^"]*"'
#
# Skript hech narsani o'chirmaydi va mavjud kalitlar ustidan yozmaydi —
# ular allaqachon bo'lsa to'xtaydi.
# =============================================================================
set -eu

ELCHI_API=${ELCHI_API:-https://api.elchipochta.uz}
MARKET_HOST=${MARKET_HOST:-marketplace}
MARKET_DIR=${MARKET_DIR:-/srv/marketplace}
# Elchi shu manzilga webhook uradi. Domen olingach https manzilga o'zgartiring.
MARKET_WEBHOOK_URL=${MARKET_WEBHOOK_URL:-http://169.58.98.223/api/v1/webhooks/elchi}
# Marketplace Elchiga shu manzil orqali murojaat qiladi.
PARTNER_API_URL=${PARTNER_API_URL:-$ELCHI_API}

if [ -z "${ELCHI_ADMIN_TOKEN:-}" ]; then
  echo "XATO: ELCHI_ADMIN_TOKEN berilmagan (Elchi SUPERADMIN JWT)." >&2
  exit 1
fi

need() { command -v "$1" >/dev/null 2>&1 || { echo "XATO: $1 topilmadi" >&2; exit 1; }; }
need curl; need ssh; need openssl

echo "== 1/5 Marketplace'da kalitlar allaqachon bormi =="
existing=$(ssh -o BatchMode=yes "$MARKET_HOST" \
  "grep -cE '^ELCHI_(PARTNER_API_URL|PARTNER_API_KEY|WEBHOOK_SECRET)=' $MARKET_DIR/.env.production || true")
if [ "${existing:-0}" -gt 0 ]; then
  echo "To'xtatildi: .env.production da allaqachon $existing ta ELCHI_* kalit bor." >&2
  echo "Qayta sozlash kerak bo'lsa avval ularni qo'lda olib tashlang." >&2
  exit 1
fi
echo "   yo'q — davom etamiz"

echo "== 2/5 Webhook sekreti yaratilmoqda =="
# 32 bayt. Validatsiya kamida 16 belgi talab qiladi.
WEBHOOK_SECRET=$(openssl rand -hex 32)
echo "   ${#WEBHOOK_SECRET} belgi yaratildi (ekranga chiqarilmaydi)"

echo "== 3/5 Elchi'da hamkor yaratilmoqda =="
response=$(curl -sS -X POST "$ELCHI_API/admin/partners" \
  -H "Authorization: Bearer $ELCHI_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Elchi Marketplace\",\"webhook_url\":\"$MARKET_WEBHOOK_URL\",\"webhook_secret\":\"$WEBHOOK_SECRET\"}")

API_KEY=$(printf '%s' "$response" | sed -n 's/.*"api_key"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
if [ -z "$API_KEY" ]; then
  echo "XATO: javobda api_key yo'q. Elchi javobi:" >&2
  printf '%s\n' "$response" | head -c 500 >&2
  echo >&2
  exit 1
fi
echo "   hamkor yaratildi, API kalit olindi (bir marta qaytariladi — saqlab qo'ying)"

echo "== 4/5 Marketplace .env.production yangilanmoqda =="
ssh -o BatchMode=yes "$MARKET_HOST" "cd $MARKET_DIR && \
  cp .env.production .env.production.bak-\$(date -u +%Y%m%dT%H%M%SZ) && \
  printf '\n# Elchi Partner API (C1.40, %s)\n' \"\$(date -u +%Y-%m-%d)\" >> .env.production && \
  printf 'ELCHI_PARTNER_API_URL=%s\n' '$PARTNER_API_URL' >> .env.production && \
  printf 'ELCHI_PARTNER_API_KEY=%s\n' '$API_KEY' >> .env.production && \
  printf 'ELCHI_WEBHOOK_SECRET=%s\n' '$WEBHOOK_SECRET' >> .env.production && \
  chmod 600 .env.production"
echo "   yozildi (eski nusxa .env.production.bak-... sifatida saqlandi)"

echo "== 5/5 Servislar qayta ko'tarilmoqda =="
ssh -o BatchMode=yes -o ServerAliveInterval=30 "$MARKET_HOST" "cd $MARKET_DIR && \
  docker compose --env-file .env.production -f docker-compose.prod.yml up -d \
    elchi-integration api-gateway checkout-service"
echo "   tayyor"

echo
echo "== Tekshiruv =="
sleep 15
printf '%-46s ' 'API /health'
curl -s -o /dev/null -w '%{http_code}\n' --max-time 15 http://169.58.98.223/api/v1/health
printf '%-46s ' 'webhook (imzosiz -> 401 kutilyapti)'
curl -s -o /dev/null -w '%{http_code}\n' --max-time 15 -X POST http://169.58.98.223/api/v1/webhooks/elchi \
  -H 'Content-Type: application/json' -d '{}'
echo
echo "Endi to'liq uchma-uch tekshiruv:"
echo "  sh scripts/verify-elchi-integration.sh"
