#!/bin/sh
# =============================================================================
# elchimarket.uz domenini uchala ilovaga qo'llaydi (C5.2 + C5.3).
#
# SERVERDA ishlatiladi:
#   ssh marketplace
#   cd /srv/marketplace
#   TUNNEL_TOKEN='eyJ...' TLS_EMAIL='siz@example.com' sh scripts/apply-domain.sh
#
# Nima qiladi:
#   1. Uchala .env.production ning zaxirasini oladi
#   2. Backend, kabinet va storefront qiymatlarini domenga o'tkazadi
#   3. cloudflared ni yoqadi, kabinet va storefront'ni qayta quradi
#   4. Natijani tekshiradi
#
# Nima QILMAYDI (ataylab, qo'lda qilinadi):
#   - Cloudflare panelidagi public hostname'lar
#   - Tashqi portlarni yopish (runbook 2.4) — avval tunnel ishlashiga ishonch
#   - Bazadagi eski rasm havolalari (runbook 3.5)
#   - Elchi hamkorining webhook_url i (runbook 3.4)
# =============================================================================
set -eu

DOMAIN_NAME=${DOMAIN_NAME:-elchimarket.uz}
API_HOST="api.$DOMAIN_NAME"
ADMIN_HOST="admin.$DOMAIN_NAME"

BACKEND_DIR=${BACKEND_DIR:-/srv/marketplace}
KABINET_DIR=${KABINET_DIR:-/home/deploy/marketplace-frontend}
STORE_DIR=${STORE_DIR:-/home/deploy/marketplace-storefront}

[ -n "${TUNNEL_TOKEN:-}" ] || { echo "XATO: TUNNEL_TOKEN berilmagan" >&2; exit 1; }
[ -n "${TLS_EMAIL:-}" ] || { echo "XATO: TLS_EMAIL berilmagan (haqiqiy pochta)" >&2; exit 1; }

stamp=$(date -u +%Y%m%dT%H%M%SZ)

# Kalitni o'rniga qo'yadi, bo'lmasa oxiriga qo'shadi.
set_key() {
  file=$1; key=$2; value=$3
  if grep -q "^${key}=" "$file"; then
    tmp=$(mktemp)
    sed "s|^${key}=.*|${key}=${value}|" "$file" > "$tmp" && mv "$tmp" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}
drop_key() {
  file=$1; key=$2
  grep -q "^${key}=" "$file" || return 0
  tmp=$(mktemp)
  grep -v "^${key}=" "$file" > "$tmp" && mv "$tmp" "$file"
}

echo "== 1/5 Zaxira nusxalar =="
for d in "$BACKEND_DIR" "$KABINET_DIR" "$STORE_DIR"; do
  if [ -f "$d/.env.production" ]; then
    cp "$d/.env.production" "$d/.env.production.bak-$stamp"
    echo "   $d/.env.production.bak-$stamp"
  else
    echo "XATO: $d/.env.production topilmadi" >&2; exit 1
  fi
done

echo "== 2/5 Backend =="
B="$BACKEND_DIR/.env.production"
# `http://` prefiksi ATAYLAB: tunnel ortida Caddy oddiy HTTP beradi va bu
# prefiks uning ACME (avtomatik HTTPS) urinishini o'chiradi.
set_key "$B" DOMAIN "http://$API_HOST"
set_key "$B" APP_DOMAIN "http://$ADMIN_HOST"
# Brauzer ko'radigan manzil — kabinet CSP'siga shu yoziladi.
set_key "$B" API_ORIGIN "https://$API_HOST"
set_key "$B" TLS_EMAIL "$TLS_EMAIL"
set_key "$B" CORS_ORIGINS "https://$ADMIN_HOST,https://$DOMAIN_NAME"
set_key "$B" MINIO_PUBLIC_URL "https://$API_HOST/media"
set_key "$B" TUNNEL_TOKEN "$TUNNEL_TOKEN"
set_key "$B" COMPOSE_PROFILES "tunnel"
chmod 600 "$B"
echo "   DOMAIN, APP_DOMAIN, API_ORIGIN, TLS_EMAIL, CORS_ORIGINS, MINIO_PUBLIC_URL, TUNNEL_TOKEN, COMPOSE_PROFILES"

echo "== 3/5 Kabinet =="
K="$KABINET_DIR/.env.production"
set_key "$K" VITE_API_URL "https://$API_HOST/api/v1"
# Bu bayroq HTTPS bo'lmagan API'ga ataylab ruxsat berardi — endi kerak emas.
drop_key "$K" VITE_ALLOW_INSECURE_API
echo "   VITE_API_URL yangilandi, VITE_ALLOW_INSECURE_API olib tashlandi"

echo "== 4/5 Storefront =="
S="$STORE_DIR/.env.production"
set_key "$S" NEXT_PUBLIC_SITE_URL "https://$DOMAIN_NAME"
# API_BASE_URL ataylab tegilmaydi: u ichki `api-gateway:3000` bo'lib qoladi
# va tashqi tarmoqqa umuman chiqmaydi.
echo "   NEXT_PUBLIC_SITE_URL yangilandi (API_BASE_URL ichki qoldi)"

echo "== 5/5 Konteynerlar =="
echo "   cloudflared + caddy..."
cd "$BACKEND_DIR"
docker compose --env-file .env.production -f docker-compose.prod.yml up -d cloudflared caddy

echo "   kabinet (qayta build — VITE_API_URL bundle ichiga yoziladi)..."
cd "$KABINET_DIR"
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build

echo "   storefront (qayta build — NEXT_PUBLIC_SITE_URL bundle ichiga yoziladi)..."
cd "$STORE_DIR"
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build

echo
echo "== Tekshiruv =="
sleep 20
say() { printf '%-52s ' "$1"; }
say "cloudflared ulanishlari"
cd "$BACKEND_DIR"
docker compose --env-file .env.production -f docker-compose.prod.yml logs cloudflared 2>/dev/null \
  | grep -c "Registered tunnel connection" || echo 0

for u in "https://$API_HOST/api/v1/health" "https://$ADMIN_HOST/" "https://$DOMAIN_NAME/"; do
  say "$u"
  curl -s -o /dev/null -w '%{http_code}\n' --max-time 20 "$u" || echo "ulanmadi"
done

echo
echo "Keyingi qadamlar (qo'lda, runbook'da batafsil):"
echo "  - 2.4 tashqi portlarni yopish (8080, 8081, 80/443)"
echo "  - 2.5 Cloudflare: SSL/TLS = Full, Always Use HTTPS, www redirect"
echo "  - 3.4 Elchi hamkorining webhook_url ini https ga o'tkazish"
echo "  - 3.5 bazadagi eski http://169.58.98.223/media havolalarini almashtirish"
