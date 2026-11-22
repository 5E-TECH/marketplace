# BE-36: ko‘p nusxada ishlash — servis DB rollari va umumiy rate limit

TZ: T9-11 (umumiy rate limit), T9-16 (servis DB rollari), T8 «Masshtab». Bajaruvchi (prod): Dilshod. Parollar bu
faylga, repoga va Trello’ga yozilmaydi.

## 1. Servis DB rollari (TC2)

`docs/schema/00-bootstrap.sql`: `mkt_migrator` (DDL egasi) va har sxemaga `mkt_<sxema>` — faqat o‘z sxemasida
SELECT/INSERT/UPDATE/DELETE, boshqa sxemaga USAGE yo‘q. `lead` sxemasi BE-36 da qo‘shildi (10 sxema).

Eng qulay payt — BE-40 dagi toza bazaga o‘tish (yangi bazada jadvallarni boshidan migrator yaratadi).

**Superuser alohida.** Hozir `docker-compose.prod.yml` da postgres konteyneri `POSTGRES_USER: ${DB_USERNAME}` bilan
yaratiladi — yangi volume’da bu foydalanuvchi superuser bo‘ladi. Rollarni yoqishdan oldin (deploy, Dilshod):
- postgres konteyneriga alohida superuser nomi va paroli (masalan `POSTGRES_SUPERUSER`/`POSTGRES_SUPERUSER_PASSWORD`;
  `pg_isready` ham shu nom bilan); `DB_USERNAME` superuser bo‘lmasin;
- eski volume’da `postgres` nomli rol bo‘lmasligi mumkin — bootstrapni mavjud superuser nomi bilan bajaring.

1. Yangi baza yaratilgach, superuser sifatida bootstrap (parollarni `CHANGE_ME_*` o‘rniga haqiqiysi bilan, faylni
   o‘zgartirmasdan — masalan `sed` bilan vaqtinchalik nusxa, keyin o‘chiring):
   `psql -U <superuser> -d <yangi_baza> -f 00-bootstrap.sql`.
   `mkt_migrator` ga bazada CREATE kerak emas — sxemalarni bootstrap yaratadi, migratsiya CLI bor sxemani qayta
   yaratmaydi.
2. Sirlar konteynerlar bo‘yicha (bitta umumiy `.env.production` hamma parolni hamma konteynerga beradi — rollar
   ma’nosiz bo‘ladi):
   - migratsiya qadami (`migrate.mjs`): `DB_USERNAME=mkt_migrator`, `DB_PASSWORD=…`, hamma `DB_USERNAME_<SXEMA>`
     (migratsiya jurnalini servis rolidan yopish uchun nomlari kerak, parollari shart emas);
   - har servis konteyneri: faqat o‘z `DB_USERNAME_<SXEMA>`/`DB_PASSWORD_<SXEMA>`. Joi `DB_USERNAME`/`DB_PASSWORD` ni
     talab qiladi — servisda ularga ham shu servis roli yozilsin (rollar yoqilganda servis umumiy foydalanuvchini
     ishlatmaydi). Compose’da `env_file` ni servis bo‘yicha ajratish yoki `environment:` bilan berish — deploy ishi.
   - Sxemalar: IDENTITY, CATALOG, INVENTORY, CHECKOUT, PAYMENT, FINANCE, INTEGRATION (elchi-integration), NOTIFICATION,
     SEARCH, LEAD.
3. Rollar yoqilganda (kamida bitta `DB_USERNAME_<SXEMA>`) servislar o‘zi migratsiya qilmaydi (`DB_AUTO_MIGRATE`
   e’tiborsiz) va **o‘z roli yoki paroli berilmagan servis ishga tushmaydi** (umumiy foydalanuvchiga jim o‘tmaydi).
   `scripts/validate-production-env.sh` hamma 10 juftni va noto‘g‘ri yozilgan kalitni tekshiradi.
   Deploydan oldin migratsiya bir martalik konteynerda, migrator sirlari bilan (servis konteynerida ular yo‘q):
   `docker compose run --rm -e DB_USERNAME -e DB_PASSWORD api-gateway node scripts/migrate.mjs run --dist`
   (qiymatlar migratsiya qadamining o‘z muhitidan, buyruq qatoriga parol yozilmaydi), keyin `… migrate.mjs check
   --dist`. `validate-production-env.sh` hozir bitta umumiy faylni tekshiradi — fayllar ajratilgach, migratsiya
   faylini (hamma `DB_USERNAME_<SXEMA>` bilan) tekshiring. CLI har sxemada servis rolidan `migrations` jadvaliga yozishni oladi.
4. Tekshiruv: `psql -U mkt_catalog -c "INSERT INTO checkout.parcel DEFAULT VALUES"` → `permission denied`.

Eski bazada (jadvallar `DB_USERNAME` egaligida) rollarni yoqish uchun egalikni `mkt_migrator` ga o‘tkazish kerak.
`REASSIGN OWNED BY <eski>` ishlamaydi, agar eski foydalanuvchi konteyner yaratgan superuser bo‘lsa («required by the
database system») — har sxema, jadval va sekvens uchun `ALTER … OWNER TO mkt_migrator`. Shuning uchun BE-40 (toza
baza) bilan birga qiling.

## 2. Umumiy rate limit (TC1)

Gateway bir necha nusxada bo‘lsa, IP limiti nusxalar orasida umumiy bo‘lishi kerak. `REDIS_URL` berilsa hisob Redis’da:
- gateway throttler — umumiy chegara `RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW_MS` va kodda `@Throttle` bilan qo‘yilgan
  auth limitlari;
- sotuvchining lid API kaliti chegarasi (lead-service, `rate_limit_per_minute`, BE-43).

`REDIS_URL` berilmasa — avvalgidek har nusxa o‘z xotirasida sanaydi. **Ishga tushishda bitta gateway nusxasi — Redis
shart emas.**

**Qanday sanaladi.** Oyna birinchi so‘rovdan boshlanadi (`RATE_LIMIT_WINDOW_MS`). Hisoblagich va blok bitta Lua
skriptida yangilanadi, shuning uchun nusxalar orasida poyga yo‘q. Kalitlar `mp:rl:gw:` va `mp:rl:apikey:` prefiksi
bilan, muddati oyna bilan teng; diskka yozish kerak emas.

Xotira saqlagichidan farqi: u sirpanuvchi oyna, Redis esa qat’iy oyna. Oyna chegarasida qisqa vaqtda limitdan 2
baravargacha so‘rov o‘tishi mumkin (masalan, oyna oxirida 300 va yangisi boshida 300). Kerak bo‘lsa limitni shunga qarab
tanlang.

**Redis uzilsa yoki javob bermay qolsa** API to‘xtamaydi:
- so‘rov xotiradagi hisob bilan o‘tadi — limit yo‘qolmaydi, faqat nusxalar orasida bo‘linmaydi;
- buyruq kutish chegarasi 250 ms [taklif]; xatodan keyin 1 s [taklif] Redis’ga murojaat qilinmaydi, shuning uchun
  so‘rovlar kutib qolmaydi;
- ulanish ochiq, lekin Redis javob bermasa (to‘xtatilgan jarayon, paket yo‘qolishi), soket 1 s [taklif] dan keyin
  yopiladi va klient qayta ulanadi;
- jurnalda ogohlantirish daqiqasiga ko‘pi bilan bir marta;
- Redis qaytsa klient o‘zi qayta ulanadi.

**Kuzatuv.** Monitor (`health-monitor.mjs`, `MONITOR_OPS_TOKEN` bilan) `GET /health/ops` dan ikki maydonni o‘qiydi:
- `rateLimit` — so‘rov tushgan gateway nusxasi;
- `leadRateLimit` — lead-service.

Biri ketma-ket `MONITOR_FAILURE_THRESHOLD` marta Redis’siz bo‘lsa — `rate_limit_redis_firing`, tiklansa
`…_resolved`. Gateway bir necha nusxada bo‘lsa, har tekshiruvda ulardan bittasi ko‘riladi.

**Yoqish (prod, Dilshod).**
1. `.env.production` ga quyidagilar qo‘shiladi:
   - `COMPOSE_PROFILES=redis` (tunnel bilan: `tunnel,redis`);
   - `REDIS_PASSWORD` — faqat harf, raqam, `_` va `-`, masalan `openssl rand -hex 24`;
   - `REDIS_URL=redis://:<REDIS_PASSWORD>@redis:6379`.

   `docker-compose.prod.yml` dagi `redis` servisi (`redis:7.4-alpine`, faqat `backend` tarmog‘ida, port ochilmaydi,
   diskka yozmaydi) shu profil bilan ko‘tariladi.
2. `scripts/validate-production-env.sh` quyidagilarni tekshiradi:
   - `REDIS_URL` parol bilan;
   - profil yoqilganda `REDIS_PASSWORD` bor va URL dagisi bilan bir xil;
   - URL `redis` servisiga qarab, profil yoqilmagan bo‘lsa — ogohlantiradi.

   Tashqi (boshqariladigan) Redis ham bo‘ladi: `rediss://…`, profil shart emas.
3. Deploydan keyin: `GET /api/v1/health/ops` (`x-monitor-token`) → `"rateLimit":{"redisConfigured":true,"store":"redis"}`;
   gateway jurnalida `Redis ulandi — limit hamma nusxada umumiy`.
4. Bir nechta gateway nusxasi (`docker compose up -d --scale api-gateway=2`) — Caddy upstream’i va healthcheck — deploy
   ishi.

**Tekshirilgan (2026-11-23, lokal, Redis 8.10):**
- Ikki gateway jarayoni (`dist`) bitta Redis bilan, `RATE_LIMIT_MAX=5`, bitta IP, so‘rovlar navbat bilan A, B, A, B, A
  ga — 401 (tokensiz). 6-so‘rov B da 429, 7-si A da 429. Boshqa IP — 401.
- Redis to‘xtatilganda bitta nusxada 5 ta so‘rov 401, 6-si 429, 500 yo‘q. Redis qaytgach klient qayta ulandi.
- Avtomat testlar:
  - `apps/api-gateway/src/rate-limit/shared-throttler.integration.spec.ts` — TC1, haqiqiy HTTP;
  - `libs/common/src/rate-limit/shared-rate-limiter.spec.ts`;
  - lid API kaliti — `lead.integration.spec.ts`.

  Hammasi `TEST_REDIS_URL` bilan, CI da `redis:7.4-alpine` servisi.
