# C5.1 → C5.2 → C5.3: domen, Cloudflare Tunnel va HTTPS'ga o'tish

Bu hujjat domen olingandan keyin bajariladigan **mexanik** tartib. Maqsad —
domen va tunnel tokeni kelgan zahoti ish 30 daqiqaga qolishi, qidiruv bilan
vaqt ketmasligi.

Holat 2026-09-10: kod tomoni tayyor (`cloudflared` servisi `docker-compose.prod.yml`
da `tunnel` profili ostida turibdi, Caddyfile ikkala rejimda ham tekshirilgan).
Kutilayotgani — **domen** (C5.1) va **tunnel tokeni** (C5.2). Ikkalasini ham
foydalanuvchi beradi.

---

## Hozirgi holat (nimadan boshlaymiz)

| Nima | Hozir | Bo'lishi kerak |
|---|---|---|
| API | `http://169.58.98.223` (IP, HTTPS yo'q) | `https://api.<domen>` |
| Kabinet | `http://169.58.98.223:8080` | `https://admin.<domen>` |
| `DOMAIN` | `:80` | `http://api.<domen>` (tunnel rejimi) |
| `APP_DOMAIN` | `kabinet.localhost` | `http://admin.<domen>` |
| `TLS_EMAIL` | `admin@localhost` | haqiqiy pochta |
| `API_ORIGIN` | (bo'sh) | `https://api.<domen>` |
| `MINIO_PUBLIC_URL` | `http://169.58.98.223/media` | `https://api.<domen>/media` |
| `CORS_ORIGINS` | IP + localhost portlari | faqat `https://` originlar |
| 8080 porti | `0.0.0.0:8080` — ochiq | yopiq (faqat tunnel orqali) |

Serverlar va kataloglar:

- Backend: `ssh marketplace` → `/srv/marketplace`
- Kabinet (frontend): `ssh marketplace` → `/home/deploy/marketplace-frontend`

---

## Nega Tunnel, nega to'g'ridan-to'g'ri Caddy emas

Ikkala yo'l ham ishlaydi:

1. **To'g'ridan-to'g'ri:** DNS A-yozuvi → server IP, 80/443 tashqariga ochiq,
   Caddy Let's Encrypt sertifikatini o'zi oladi.
2. **Cloudflare Tunnel (C5.2 tanlagan yo'l):** `cloudflared` serverdan
   Cloudflare tomon **chiquvchi** ulanish quradi. 80/443 ni tashqariga ochish
   shart emas, server IP'si yashirin qoladi, DDoS himoyasi Cloudflare tomonida.

Tunnel rejimida TLS **Cloudflare chekkasida** tugaydi, Caddy tunnel ortida
oddiy HTTP beradi. Shuning uchun `DOMAIN` ga `http://` prefiksi qo'yiladi —
bu Caddy'ga "bu sayt uchun avtomatik HTTPS qilma" deydi. Tekshirilgan:

```
DOMAIN=api.example.com        → "enabling automatic HTTP->HTTPS redirects"  (ACME yo'li)
DOMAIN=http://api.example.com → redirect yo'q                               (tunnel yo'li)
```

`API_ORIGIN` aynan shuning uchun `DOMAIN`dan **alohida** o'zgaruvchi: kabinet
CSP'siga brauzer ko'radigan manzil (`https://...`) kerak, `DOMAIN` esa tunnel
rejimida `http://...` bo'ladi. Ilgari Caddyfile'da `https://{$DOMAIN}` yozilgan
edi — tunnelga o'tganda u `https://http://api...` ga aylanib CSP'ni buzardi.

---

## 1-qadam — C5.1: domen va DNS

1. Domenni ro'yxatdan o'tkazish (foydalanuvchi bajaradi).
2. Cloudflare'ga zona sifatida qo'shish, registrarda nameserverlarni
   Cloudflare'nikiga almashtirish. Zona `Active` bo'lguncha kutiladi.
3. DNS yozuvlari **qo'lda qo'shilmaydi** — 2-qadamda tunnel ularni
   (`CNAME ... .cfargotunnel.com`, proxied) o'zi yaratadi.

**C5.1 checklisti:**

- TC1 `dig admin.<domen>` javob beradi → 2-qadamdan keyin tekshiriladi
- TC2 `dig api.<domen>` javob beradi → 2-qadamdan keyin
- TC3 domen Cloudflare panelida `Active`

---

## 2-qadam — C5.2: Cloudflare Tunnel

### 2.1 Tunnel yaratish (Cloudflare paneli)

Zero Trust → Networks → Tunnels → **Create a tunnel** → Cloudflared →
nom: `marketplace`. Chiqqan **tokenni** nusxalash (`eyJ...` bilan boshlanadi).

> Token — sir. Uni Trello'ga, commit'ga yoki chatga yozmaslik kerak.

### 2.2 Public hostname'lar (o'sha panelda)

| Subdomain | Domain | Type | URL |
|---|---|---|---|
| `api` | `<domen>` | HTTP | `caddy:80` |
| `admin` | `<domen>` | HTTP | `frontend:8080` |

`api` Caddy orqali o'tadi — `/media` proxy'si, xavfsizlik sarlavhalari va
health-check shu yerda. `admin` to'g'ridan-to'g'ri SPA konteyneriga boradi.

Ikkala nom ham `marketplace_edge` docker tarmog'idagi konteyner nomlari;
`cloudflared` shu tarmoqda turgani uchun ularni ko'ra oladi.

### 2.3 Serverda yoqish

`/srv/marketplace/.env.production` ga qo'shiladi:

```sh
TUNNEL_TOKEN=<panel bergan token>
COMPOSE_PROFILES=tunnel

DOMAIN=http://api.<domen>
APP_DOMAIN=http://admin.<domen>
API_ORIGIN=https://api.<domen>
TLS_EMAIL=<haqiqiy pochta>
```

Keyin:

```sh
cd /srv/marketplace
docker compose -f docker-compose.prod.yml --env-file .env.production up -d cloudflared caddy
docker compose -f docker-compose.prod.yml logs cloudflared --tail 30
```

Loglarda `Registered tunnel connection` (odatda 4 ta) ko'rinishi kerak.

### 2.4 8080 portini yopish

Tunnel ishlagach kabinet `0.0.0.0:8080` orqali ochiq turishi shart emas.
`/home/deploy/marketplace-frontend/docker-compose.prod.yml` da port
publish'ini olib tashlash (yoki `127.0.0.1:8080:8080` ga o'zgartirish), so'ng
`docker compose up -d`.

**C5.2 checklisti:**

- TC1 `https://api.<domen>/api/v1/health` → 200
- TC2 `https://admin.<domen>` kabinetni ochadi
- TC3 sertifikat yaroqli (brauzer ogohlantirmaydi)
- TC4 `curl http://169.58.98.223:8080` tashqaridan javob bermaydi

---

## 3-qadam — C5.3: vaqtinchalik yon yechimlarni olib tashlash

Bular sinov uchun **ataylab** qo'yilgan edi. Domen ishlagach hammasi
olib tashlanmasa, production HTTPS'siz qolib ketadi.

### 3.1 Kabinet (`/home/deploy/marketplace-frontend/.env.production`)

```diff
-VITE_ALLOW_INSECURE_API=true
-VITE_API_URL=http://169.58.98.223/api/v1
+VITE_API_URL=https://api.<domen>/api/v1
```

`VITE_API_URL` **build vaqtida** bundle ichiga yoziladi — o'zgartirilgach
qayta build shart (`docker compose build --no-cache frontend && up -d`).

`VITE_ALLOW_INSECURE_API` bayrog'i `src/shared/api/httpClient.ts` dagi
`resolveApiUrl()` da tekshiriladi. Aniqlik uchun: u **build'ni emas, ilovaning
ishga tushishini** to'xtatadi — `axios.create()` modul yuklanayotganda
chaqiriladi, ya'ni bayroqsiz va `http://` manzil bilan build muvaffaqiyatli
o'tadi, lekin kabinet brauzerda ochilmay xato beradi. Shuning uchun 3.1 dagi
ikki qatorni **birga** o'zgartirish kerak: bayroqni olib tashlab, manzilni
`https://` ga o'tkazmaslik — kabinetni ishdan chiqaradi.

### 3.2 Backend (`/srv/marketplace/.env.production`)

```diff
-CORS_ORIGINS=http://5.189.141.169:3004,http://localhost:5173,http://localhost:5174,http://169.58.98.223:8080
+CORS_ORIGINS=https://admin.<domen>,https://<storefront-domeni>
-MINIO_PUBLIC_URL=http://169.58.98.223/media
+MINIO_PUBLIC_URL=https://api.<domen>/media
```

> `http://5.189.141.169:3004` — Elchi backendining origini. Elchi
> marketplace API'siga brauzerdan emas, server-server murojaat qiladi, ya'ni
> unga CORS kerak emas. Olib tashlashdan oldin Elchi tomonidagi
> `MARKETPLACE_WEBHOOK_URL` ni ham `https://api.<domen>` ga o'tkazish kerak
> ([[C1.40]] webhook zanjiri shu manzilga uradi).

> `localhost:5173/5174` — dasturchilarning lokal Vite portlari. Ular
> production `.env` da turishi kerak emas; kerak bo'lsa alohida dev muhitida.

### 3.3 MinIO'dagi eski havolalar

`MINIO_PUBLIC_URL` o'zgargach **yangi** yuklangan rasmlar https havola oladi.
Bazada saqlangan eski `http://169.58.98.223/media/...` havolalari o'z-o'zidan
o'zgarmaydi — mahsulot rasmlari mixed-content bo'lib ko'rinmay qolishi mumkin.
Tekshirish va kerak bo'lsa bir martalik `UPDATE` bilan almashtirish.

**C5.3 checklisti:**

- TC1 frontend build `VITE_ALLOW_INSECURE_API` bayrog'isiz o'tadi
- TC2 CORS javobida faqat https origin ruxsat etiladi
- TC3 mahsulot rasmi https orqali ochiladi (3.3 dagi eski havolalarni unutmaslik)
- TC4 http manzil https ga yo'naltiriladi (Cloudflare'da SSL/TLS → Edge
  Certificates → **Always Use HTTPS** yoqiladi)

---

## 4-qadam — zanjirning qolgan qismini ochish

Domen ishlagach quyidagilar to'siqdan chiqadi:

- **C3.3 / C7.1 (Click, Payme sandbox):** provayderga beriladigan callback
  manzillari paydo bo'ladi:
  - `https://api.<domen>/api/v1/payments/click/prepare`
  - `https://api.<domen>/api/v1/payments/click/complete`
  - `https://api.<domen>/api/v1/payments/payme/callback`
  Batafsil: `docs/PAYMENT_INTEGRATION.md`.
- **C4.6 (E2E smoke + monitoring):** `npm run ops:c46-preflight` aynan
  `DOMAIN` ni talab qiladi va hozir shuning uchun yiqiladi. U yana
  `ALERT_WEBHOOK_URL` (https) va `ELCHI_WEBHOOK_SECRET` ni ham tekshiradi.
- **C2.28 (storefront deploy):** storefront ham shu tunnelga uchinchi public
  hostname sifatida qo'shiladi.

---

## Orqaga qaytarish

Tunnel bilan muammo chiqsa, IP orqali ishlashga qaytish:

```sh
# .env.production da:
#   COMPOSE_PROFILES qatorini olib tashlash
#   DOMAIN=:80  APP_DOMAIN=kabinet.localhost  API_ORIGIN=
cd /srv/marketplace
docker compose -f docker-compose.prod.yml --env-file .env.production stop cloudflared
docker compose -f docker-compose.prod.yml --env-file .env.production up -d caddy
```

`cloudflared` `profiles: [tunnel]` ostida turgani uchun `COMPOSE_PROFILES`
qo'yilmasa umuman ko'tarilmaydi — ya'ni bu o'zgarish hozirgi IP orqali
ishlashni buzmaydi.
