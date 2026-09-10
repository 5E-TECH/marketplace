#!/bin/sh
# =============================================================================
# Elchi <-> Marketplace integratsiyasini uchma-uch tekshiradi (C1.40 TC4).
#
# `setup-elchi-integration.sh` dan keyin ishlatiladi. Hech nima o'zgartirmaydi.
#
# Sekret serverdan CHIQMAYDI: webhook imzosi api-gateway konteyneri ichida,
# o'sha yerdagi ELCHI_WEBHOOK_SECRET bilan hisoblanadi.
#
#   sh scripts/verify-elchi-integration.sh
# =============================================================================
set -eu

API=${API:-http://169.58.98.223/api/v1}
MARKET_HOST=${MARKET_HOST:-marketplace}
MARKET_DIR=${MARKET_DIR:-/srv/marketplace}
SESSION="verify-elchi-$(date -u +%Y%m%d%H%M%S)"

say() { printf '%-52s ' "$1"; }
compose="docker compose --env-file .env.production -f docker-compose.prod.yml"

echo "=== 1. Konfiguratsiya joyidami ==="
say 'ELCHI_* kalitlari .env.production da'
ssh -o BatchMode=yes "$MARKET_HOST" \
  "grep -cE '^ELCHI_(PARTNER_API_URL|PARTNER_API_KEY|WEBHOOK_SECRET)=' $MARKET_DIR/.env.production"

echo
echo "=== 2. Chiquvchi yo'nalish: dostavka narxi (C2.20 ni ham tuzatadi) ==="
say 'savat yaratish'
curl -s -o /dev/null -w '%{http_code}\n' --max-time 20 -X POST "$API/cart/items" \
  -H 'Content-Type: application/json' -H "x-session-id: $SESSION" \
  -d '{"productId":"4","variantId":"4","quantity":1}'

say 'POST /checkout/delivery-preview'
preview=$(curl -s --max-time 30 -X POST "$API/checkout/delivery-preview" \
  -H 'Content-Type: application/json' -H "x-session-id: $SESSION" \
  -d '{"address":{"recipientName":"QA Sinov","phone":"+998901234567","address":"Toshkent, sinov","regionId":"10","districtId":"101"}}')
code=$(printf '%s' "$preview" | sed -n 's/.*"statusCode"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p')
echo "${code:-?}"
if [ "${code:-500}" = "500" ]; then
  echo "  YIQILDI: hamon 500. Javob:" >&2
  printf '   %s\n' "$(printf '%s' "$preview" | head -c 300)" >&2
else
  printf '   %s\n' "$(printf '%s' "$preview" | head -c 300)"
fi

echo
echo "=== 3. Kiruvchi yo'nalish: Elchi -> marketplace webhook (TC4) ==="
occurred=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
body="{\"eventId\":\"verify-$(date -u +%s)\",\"type\":\"shipment.status_changed\",\"shipmentId\":\"77012\",\"externalOrderId\":\"1\",\"status\":\"delivered\",\"occurredAt\":\"$occurred\"}"

# Imzo konteyner ichida hisoblanadi — sekret shu yerda qoladi.
signature=$(ssh -o BatchMode=yes "$MARKET_HOST" "cd $MARKET_DIR && $compose exec -T api-gateway \
  node -e 'const{createHmac}=require(\"crypto\");process.stdout.write(createHmac(\"sha256\",process.env.ELCHI_WEBHOOK_SECRET).update(process.argv[1],\"utf8\").digest(\"hex\"))' '$body'")

say 'TO'"'"'G'"'"'RI imzo bilan (401 BO'"'"'LMASLIGI kerak)'
ok_code=$(curl -s -o /tmp/elchi-hook-ok.json -w '%{http_code}' --max-time 20 -X POST "$API/webhooks/elchi" \
  -H 'Content-Type: application/json' -H "X-Elchi-Signature: $signature" -d "$body")
echo "$ok_code"
printf '   %s\n' "$(head -c 200 /tmp/elchi-hook-ok.json 2>/dev/null)"

say 'NOTO'"'"'G'"'"'RI imzo bilan (401 KUTILYAPTI)'
curl -s -o /dev/null -w '%{http_code}\n' --max-time 20 -X POST "$API/webhooks/elchi" \
  -H 'Content-Type: application/json' -H 'X-Elchi-Signature: yolgon' -d "$body"

echo
echo "=== 4. Elchi tomonida outbox =="
say 'partner_webhook_outbox qatorlari'
ssh -o BatchMode=yes elchi 'cd /home/shodiyor/apps/backend && docker compose exec -T postgres \
  sh -lc "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -tAc \"select count(*) from integration_schema.partner_webhook_outbox;\""' 2>/dev/null || echo '?'

echo
echo "XULOSA:"
echo "  2-bo'lim 500 BO'LMASA  -> ELCHI_PARTNER_API_URL/KEY ishlayapti (C2.20 tuzaldi)"
echo "  3-bo'limda to'g'ri imzo 401 BO'LMASA va noto'g'risi 401 BO'LSA -> C1.40 TC4 bajarildi"
