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

Gateway bir necha nusxada bo‘lsa, IP limiti nusxalar orasida umumiy bo‘lishi kerak — Redis. **Ega ruxsatini kutadi:**
Redis klienti (`ioredis`, npm) va lokal sinov uchun Redis o‘rnatish (yuklab olish). Ruxsat bo‘lgach: gateway
`REDIS_URL` bilan Redis’da sanaydi (bo‘lmasa — hozirgidek xotirada), compose’ga `redis` servisi, CI ga Redis.
