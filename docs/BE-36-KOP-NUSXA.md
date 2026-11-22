# BE-36: ko‘p nusxada ishlash — servis DB rollari va umumiy rate limit

TZ: T9-11 (umumiy rate limit), T9-16 (servis DB rollari), T8 «Masshtab». Bajaruvchi (prod): Dilshod. Parollar bu
faylga, repoga va Trello’ga yozilmaydi.

## 1. Servis DB rollari (TC2)

`docs/schema/00-bootstrap.sql`: `mkt_migrator` (DDL egasi) va har sxemaga `mkt_<sxema>` — faqat o‘z sxemasida
SELECT/INSERT/UPDATE/DELETE, boshqa sxemaga USAGE yo‘q. `lead` sxemasi BE-36 da qo‘shildi (10 sxema).

Eng qulay payt — BE-40 dagi toza bazaga o‘tish (yangi bazada jadvallarni boshidan migrator yaratadi):

1. Yangi baza yaratilgach, superuser sifatida bootstrap (parollarni `CHANGE_ME_*` o‘rniga haqiqiysi bilan, faylni
   o‘zgartirmasdan — masalan `sed` bilan vaqtinchalik nusxa):
   `psql -U postgres -d <yangi_baza> -f 00-bootstrap.sql`
2. `.env.production`:
   - `DB_USERNAME=mkt_migrator`, `DB_PASSWORD=…` — migratsiya CLI shu bilan ishlaydi;
   - har servis: `DB_USERNAME_CATALOG=mkt_catalog`, `DB_PASSWORD_CATALOG=…` (IDENTITY, CATALOG, INVENTORY, CHECKOUT,
     PAYMENT, FINANCE, INTEGRATION, NOTIFICATION, SEARCH, LEAD).
3. Kamida bitta `DB_USERNAME_<SXEMA>` berilsa servislar o‘zi migratsiya qilmaydi (`DB_AUTO_MIGRATE` e’tiborsiz):
   deploydan oldin `docker compose run --rm api-gateway node scripts/migrate.mjs run --dist`, keyin
   `… migrate.mjs check --dist`.
4. Tekshiruv: `psql -U mkt_catalog -c "INSERT INTO checkout.parcel DEFAULT VALUES"` → `permission denied`.

Eski bazada (jadvallar `DB_USERNAME` egaligida) rollarni yoqish uchun avval egalikni `mkt_migrator` ga o‘tkazish kerak
(`REASSIGN OWNED`) — BE-40 dan keyin shart emas.

## 2. Umumiy rate limit (TC1)

Gateway bir necha nusxada bo‘lsa, IP limiti nusxalar orasida umumiy bo‘lishi kerak — Redis. **Ega ruxsatini kutadi:**
Redis klienti (`ioredis`, npm) va lokal sinov uchun Redis o‘rnatish (yuklab olish). Ruxsat bo‘lgach: gateway
`REDIS_URL` bilan Redis’da sanaydi (bo‘lmasa — hozirgidek xotirada), compose’ga `redis` servisi, CI ga Redis.
