# C5.1 → C5.2 → C5.3: elchimarket.uz, Cloudflare Tunnel va HTTPS

Domen olindi: **`elchimarket.uz`** (Eskiz'dan, 2026-09-12). Bu hujjat qolgan
ishni bosqichma-bosqich, aniq qiymatlar bilan bajarish uchun.

## Yakuniy tuzilish

```
elchimarket.uz         → storefront:3001   (xaridor sayti, Next.js SSR)
admin.elchimarket.uz   → caddy:80          (sotuvchi kabineti + admin panel)
api.elchimarket.uz     → caddy:80          (API)
www.elchimarket.uz     → elchimarket.uz    (redirect)
```

Uchala manzil ham **Cloudflare Tunnel** orqali chiqadi: server portlari
tashqariga ochilmaydi, TLS Cloudflare chekkasida tugaydi.

### Nega ikkitasi Caddy orqali, storefront esa to'g'ridan-to'g'ri

`deploy/Caddyfile` da allaqachon ikkita sayt bloki bor va ular kerakli ishni
qiladi — qayta yozish shart emas:

- `{$DOMAIN}` bloki — API: `/media/*` ni MinIO'ga proxy qiladi, xavfsizlik
  sarlavhalarini qo'yadi, api-gateway'ga health-check bilan boradi.
- `{$APP_DOMAIN}` bloki — kabinet: CSP qo'yadi va `frontend:8080` ga proxy qiladi.

Storefront esa Next.js serveri: o'z sarlavhalarini o'zi qo'yadi va SSR
paytida Host/protokolga tayanadi. Uning oldiga yana bir proxy qo'yish
foyda bermaydi, aksincha kanonik havola va `og:url` ni buzishi mumkin.
Shuning uchun tunnel unga to'g'ridan-to'g'ri boradi.

**Natija: Caddyfile'ga tegilmaydi.** Faqat muhit o'zgaruvchilari o'zgaradi.

---

## 1-bosqich — C5.1: domen va DNS

**Bajarildi:** domen Cloudflare'ga qo'shilgan (Free tarif), NS Eskiz panelida
`anita.ns.cloudflare.com` va `nero.ns.cloudflare.com` ga o'zgartirilgan.

**Kutilmoqda:** `.uz` registry delegatsiyani yangilashi. Tekshirish:

```bash
dig NS elchimarket.uz @ns1.uz +short     # cloudflare.com chiqishi kerak
dig SOA elchimarket.uz +short @1.1.1.1   # NOERROR bo'lishi kerak
```

> Oraliq holatda `SERVFAIL` normal: registry hali Eskiz'ni ko'rsatadi, Eskiz
> esa zonani endi xizmat qilmaydi (`REFUSED`). Registry yozuvining TTL'i
> 14400s (4 soat). 4–6 soatdan keyin ham o'zgarmasa — Eskiz qo'llab-quvvatlash
> xizmatiga yozish kerak, delegatsiya cctld.uz ga yuborilmagan bo'ladi.

DNS yozuvlarini **qo'lda qo'shmang** — tunnel ularni o'zi yaratadi.

---

## 2-bosqich — C5.2: Cloudflare Tunnel

### 2.1 Tunnel yaratish

Cloudflare → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel**
→ **Cloudflared** → nom: `marketplace` → **Save**.

Chiqqan **tokenni** nusxalang (`eyJ...` bilan boshlanadi).

> Token — sir. Trello'ga, commit'ga yoki chatga yozilmaydi. To'g'ridan-to'g'ri
> serverdagi `.env.production` ga qo'yiladi.

### 2.2 Public hostname'lar

O'sha tunnel ichida **Public Hostname** bo'limiga uchta yozuv qo'shiladi:

| # | Subdomain | Domain | Type | URL |
|---|---|---|---|---|
| 1 | *(bo'sh)* | `elchimarket.uz` | HTTP | `storefront:3001` |
| 2 | `admin` | `elchimarket.uz` | HTTP | `caddy:80` |
| 3 | `api` | `elchimarket.uz` | HTTP | `caddy:80` |

Har biri saqlanganda Cloudflare DNS'ga mos `CNAME` (proxied) yozuvini
avtomatik qo'shadi.

`www` uchun alohida hostname shart emas — uni 2.5 da redirect bilan hal qilamiz.

### 2.3 Serverda yoqish

`/srv/marketplace/.env.production` ga qo'shiladi:

```sh
TUNNEL_TOKEN=<panel bergan token>
COMPOSE_PROFILES=tunnel
```

So'ng:

```bash
cd /srv/marketplace
docker compose --env-file .env.production -f docker-compose.prod.yml up -d cloudflared
docker compose --env-file .env.production -f docker-compose.prod.yml logs cloudflared --tail 30
```

Loglarda `Registered tunnel connection` (odatda 4 ta) ko'rinishi kerak.

### 2.4 Portlarni yopish

Tunnel ishlagach tashqi portlar kerak emas:

- `/home/deploy/marketplace-frontend/docker-compose.prod.yml` → `ports` bo'limini
  olib tashlash (yoki `127.0.0.1:8080:8080` qilish)
- `/home/deploy/marketplace-storefront/docker-compose.prod.yml` → xuddi shunday
  (`8081`)
- `/srv/marketplace/docker-compose.prod.yml` → `caddy` servisidagi `80`, `443`
  publish'larini olib tashlash

Har birida o'zgarishdan keyin `docker compose up -d`.

### 2.5 Cloudflare panelida ikkita sozlama

- **SSL/TLS → Overview** → rejim **Full** (Flexible EMAS).
- **SSL/TLS → Edge Certificates** → **Always Use HTTPS** yoqiladi.
- **Rules → Redirect Rules** → `www.elchimarket.uz/*` → `https://elchimarket.uz/$1`
  (301).

**C5.2 checklisti:**

- TC1 `https://api.elchimarket.uz/api/v1/health` → 200
- TC2 `https://admin.elchimarket.uz` kabinetni ochadi
- TC3 sertifikat yaroqli (brauzer ogohlantirmaydi)
- TC4 `curl http://169.58.98.223:8080` tashqaridan javob bermaydi

---

## 3-bosqich — C5.3: vaqtinchalik yon yechimlarni olib tashlash

Bular IP+HTTP bilan sinash uchun **ataylab** qo'yilgan edi. Domen ishlagach
hammasi olib tashlanmasa, production HTTPS'siz qolib ketadi.

### 3.1 Backend — `/srv/marketplace/.env.production`

```diff
-DOMAIN=:80
+DOMAIN=http://api.elchimarket.uz
-APP_DOMAIN=kabinet.localhost
+APP_DOMAIN=http://admin.elchimarket.uz
+API_ORIGIN=https://api.elchimarket.uz
-TLS_EMAIL=admin@localhost
+TLS_EMAIL=<haqiqiy pochta>
-CORS_ORIGINS=http://5.189.141.169:3004,http://localhost:5173,http://localhost:5174,http://169.58.98.223:8080
+CORS_ORIGINS=https://admin.elchimarket.uz,https://elchimarket.uz
-MINIO_PUBLIC_URL=http://169.58.98.223/media
+MINIO_PUBLIC_URL=https://api.elchimarket.uz/media
```

**`DOMAIN` va `APP_DOMAIN` da `http://` prefiksi ATAYLAB.** Tunnel rejimida
TLS Cloudflare chekkasida tugaydi va Caddy tunnel ortida oddiy HTTP beradi;
bu prefiks Caddy'ning avtomatik HTTPS'ini (ACME) o'chiradi. `API_ORIGIN` esa
brauzer ko'radigan manzil, shuning uchun `https://` — u kabinet CSP'siga
yoziladi.

> `http://5.189.141.169:3004` — Elchi backendining origini. Elchi marketplace
> API'siga brauzerdan emas, server-server murojaat qiladi, ya'ni unga CORS
> kerak emas.

### 3.2 Kabinet — `/home/deploy/marketplace-frontend/.env.production`

```diff
-VITE_ALLOW_INSECURE_API=true
-VITE_API_URL=http://169.58.98.223/api/v1
+VITE_API_URL=https://api.elchimarket.uz/api/v1
```

`VITE_API_URL` **build vaqtida** bundle ichiga yoziladi — qayta build shart:

```bash
cd /home/deploy/marketplace-frontend
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

⚠️ Ikki qatorni **birga** o'zgartiring. `VITE_ALLOW_INSECURE_API` ni olib
tashlab, manzilni `https://` ga o'tkazmasangiz — build yashil bo'ladi, lekin
kabinet brauzerda umuman ochilmaydi (`resolveApiUrl` modul yuklanayotganda
xato tashlaydi).

### 3.3 Storefront — `/home/deploy/marketplace-storefront/.env.production`

```diff
-NEXT_PUBLIC_SITE_URL=http://169.58.98.223:8081
+NEXT_PUBLIC_SITE_URL=https://elchimarket.uz
```

`API_BASE_URL` o'zgarmaydi — u ichki `http://api-gateway:3000/api/v1` bo'lib
qoladi va tashqi tarmoqqa umuman chiqmaydi.

`NEXT_PUBLIC_SITE_URL` kanonik havola va `og:url` uchun ishlatiladi, shuning
uchun qayta build kerak.

### 3.4 Elchi tomoni

Elchi'dagi marketplace hamkorining `webhook_url` i hozir IP'ga ishora qiladi.
Uni yangilash kerak:

```
http://169.58.98.223/api/v1/webhooks/elchi
  → https://api.elchimarket.uz/api/v1/webhooks/elchi
```

### 3.5 Bazadagi eski rasm havolalari

`MINIO_PUBLIC_URL` o'zgargach **yangi** yuklangan rasmlar https havola oladi.
Bazada saqlangan eski `http://169.58.98.223/media/...` havolalari o'z-o'zidan
o'zgarmaydi va sahifada mixed-content bo'lib ko'rinmay qolishi mumkin.

Tekshirish va bir martalik almashtirish:

```sql
select count(*) from catalog.product where image_url like 'http://169.58.98.223%';
update catalog.product
   set image_url = replace(image_url, 'http://169.58.98.223/media', 'https://api.elchimarket.uz/media')
 where image_url like 'http://169.58.98.223%';
```

`catalog.product_image` (yoki `images` jsonb) uchun ham xuddi shunday.

**C5.3 checklisti:**

- TC1 frontend build `VITE_ALLOW_INSECURE_API` bayrog'isiz o'tadi
- TC2 CORS javobida faqat https origin ruxsat etiladi
- TC3 mahsulot rasmi https orqali ochiladi (3.5 ni unutmaslik)
- TC4 http manzil https ga yo'naltiriladi (2.5 dagi *Always Use HTTPS*)

---

## 4-bosqich — zanjirning qolgani ochiladi

Domen ishlagach quyidagilar to'siqdan chiqadi:

- **C3.3 / C7.1 (Click, Payme sandbox):** provayderga beriladigan HTTPS
  callback manzillari paydo bo'ladi:
  - `https://api.elchimarket.uz/api/v1/payments/click/prepare`
  - `https://api.elchimarket.uz/api/v1/payments/click/complete`
  - `https://api.elchimarket.uz/api/v1/payments/payme/callback`
- **C4.6:** `npm run ops:c46-preflight` aynan `DOMAIN` ni talab qiladi va
  hozir shuning uchun yiqiladi.
- **C8.1 (MVP qo'lda testi):** TC1 "sayt HTTPS bilan ochiladi" yopiladi.
  (Qolgan TC'lari C2.17 checkout'ga bog'liq.)
- **C2.28 TC1/TC4** yopiladi.

---

## Orqaga qaytarish

Tunnel bilan muammo chiqsa, IP orqali ishlashga qaytish:

```bash
cd /srv/marketplace
# .env.production da: COMPOSE_PROFILES qatorini olib tashlash,
#   DOMAIN=:80  APP_DOMAIN=kabinet.localhost  API_ORIGIN=
docker compose --env-file .env.production -f docker-compose.prod.yml stop cloudflared
docker compose --env-file .env.production -f docker-compose.prod.yml up -d caddy
```

Portlarni qaytadan ochish kerak bo'lsa, 2.4 dagi o'zgarishlarni teskari qiling.
`cloudflared` `profiles: [tunnel]` ostida turgani uchun `COMPOSE_PROFILES`
qo'yilmasa umuman ko'tarilmaydi.
