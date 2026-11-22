# BE-40: ishga tushirish — eski bazani arxivlash, toza baza, kalitlar, prodda tekshiruv

TZ: 1-bo‘lim 3-qaror (elchimarket.uz yopiladi, ma’lumot ko‘chirilmaydi); T8 «Zaxira nusxa»; 10-bo‘lim «Ishga
tushirish» darvozasi (QA-05). Bajaruvchi: Dilshod (prod server), ega (qarorlar va kalitlar). Kalitlar bu faylga,
repoga va Trello kartasiga yozilmaydi — faqat «olindi».

## 0. Oldin tugashi kerak (to‘siqlar)

| Shart | Karta/qaror | Nega |
|---|---|---|
| Eski platforma yopildi, arxiv saqlash muddati aniq | EQ-13, SF-00 | arxivda eski mijozlarning shaxsiy ma’lumoti bor |
| Zaxira serveri, `BACKUP_REMOTE`, SSH kaliti | BE-26 | arxiv boshqa serverda bo‘lishi shart (T8) |
| SMS provayderi va `SMS_WEBHOOK_URL` | EQ-03, BE-24 | SMS kodsiz sotuvchi ro‘yxatdan o‘ta olmaydi (BE-06) |
| Sotuvchi sahifasi domeni, Cloudflare hostname | EQ-05, SF-01…03 | `LANDING_*`, `MONITOR_LANDING_URL` |
| Elchi platforma marketi va kaliti | EQ-06, BE-20 | `ELCHI_PLATFORM_MARKET_ID`, `ELCHI_PARTNER_API_KEY` |
| Oferta va rozilik matni (yurist) | EQ-10, BE-06 | matnsiz ro‘yxat yopiq (seed 1.0 bo‘sh) |
| Operator kodlari | QA 2026-11-21 | `LEAD_PHONE_OPERATOR_CODES` bo‘sh bo‘lsa +998 12 ham qabul qilinadi |

## 1. Kalitlar va sozlamalar (`.env.production`, serverda)

- **Yangi JWT sirlari** — `JWT_SECRET`, `JWT_REFRESH_SECRET` almashtiriladi: toza bazada ID lar qaytadan boshlanadi,
  eski tokenlar yangi foydalanuvchiga to‘g‘ri kelib qolmasin (BE-05 eslatmasi). `JWT_REGISTRATION_SECRET`,
  `OTP_HASH_SECRET`, `TWO_FACTOR_SECRET_KEY` (≥ 32) — alohida.
- `SEED_ADMIN_PHONE`, `SEED_ADMIN_PASSWORD` — birinchi SUPERADMIN (identity ishga tushganda yaratiladi).
- Relaylar: `LEAD_OUTBOX_RELAY=on`, `ELCHI_OUTBOX_RELAY=on` — sukut bo‘yicha o‘chiq, ularsiz lid buyurtmaga, buyurtma
  Elchi’ga bormaydi (`docs/EVENTS.md`).
- `ELCHI_FISCAL_RECEIPT=off` — Elchi chek maydonlarini qabul qilguncha (BE-41).
- `SWAGGER_ENABLED=off`, `ADMIN_2FA=off` (FE-27 chiqquncha), `MONITOR_TOKEN`/`MONITOR_OPS_TOKEN` (BE-26).
- Tekshirish: `sh scripts/validate-production-env.sh`.

## 2. Eski bazani arxivlash va yangi bo‘sh baza

```sh
cd /srv/marketplace
sh scripts/launch-fresh-db.sh elchi_marketplace_v2          # nima qilinishini ko‘rsatadi
sh scripts/launch-fresh-db.sh elchi_marketplace_v2 --apply  # arxiv → zaxira serveri, keyin bo‘sh baza
```

Skript: eski bazaning `pg_dump` nusxasi `BACKUP_REMOTE` ga (checksum bilan, `.partial` → asl nom), keyin
`elchi_marketplace_v2` yaratiladi (bor bo‘lsa — bo‘sh ekani tekshiriladi). **Eski baza o‘chirilmaydi** — orqaga
qaytish yo‘li (6-bo‘lim); EQ-13 muddati tugagach alohida o‘chiriladi.

**TC4** — arxiv zaxira serverida ochiladi:

```sh
# zaxira serverida
BACKUP_DIR=/srv/elchi-backups sh scripts/db-restore-test.sh /srv/elchi-backups/<arxiv>.dump
```

## 3. Yangi bazaga o‘tish

1. RabbitMQ: eski konteynerlar to‘xtagach `npm run ops:rmq-migrate-v2 -- --apply` (BE-02, `_v2` navbatlar);
   RabbitMQ konteyneriga doimiy `hostname`.
2. `.env.production` da `DB_NAME=elchi_marketplace_v2`.
3. Deploy (3 repo va sotuvchi sahifasi konteyneri birga). Servislar ishga tushishda migratsiyalarni o‘zi yurgizadi
   (`DB_AUTO_MIGRATE`), HQ ombor va narx/tarif sukutlari migratsiyalarda, SUPERADMIN — seed.
4. **TC2:** `docker compose exec api-gateway node scripts/migrate.mjs check --dist` — «yangi migratsiya yo‘q» va
   «hamma jadval va ustun migratsiyada bor» (lokal 2026-11-22: 10 servis, ikkinchi yurgizish o‘zgarishsiz).
5. **TC1:** SUPERADMIN bilan kirish (`POST /api/v1/auth/login`); bazada eski foydalanuvchi, do‘kon va mahsulot yo‘q:
   `SELECT count(*) FROM identity.users` = 1.
6. Superadmin oferta va rozilik matnini e’lon qiladi (`PUT /api/v1/admin/legal/documents/{type}`).

## 4. Prodda tekshiruv

- **TC5:** `GET /api/v1/health/readiness` — hamma servislar, lead-service ham `up`; sotuvchi sahifasi `/healthz`.
- **TC6:** sotuvchi sahifasidan test lid va admin audit jurnalida mijozning haqiqiy IP si (Cloudflare → cloudflared →
  sotuvchi sahifasi → gateway zanjiri; `apps/api-gateway/src/trust-proxy.ts`, `docs/C4.8-TRUST-PROXY.md`).
- **TC3:** test buyurtma: optovik va mahsulot (MXIK, qadoq kodi, video bilan) → sotuvchi sahifasi → lid → operator
  tasdig‘i → buyurtma → Elchi posilkasi yaratildi → **bekor qilinadi** (Elchi’da ham). Natija TC3 izohiga.

## 5. Kuzatuv

`npm run ops:monitor` (BE-26): API, consumerlar, DLQ, Elchi xatolari, lid navbati. Zaxira har kuni
(`production-backup.yml`) — `BACKUP_REMOTE` bilan tashqi serverga.

## 6. Orqaga qaytish yo‘li

1. `.env.production` da `DB_NAME` eski bazaga qaytariladi (u o‘chirilmagan).
2. Oldingi image: deploy `rollback-previous` tegi bilan; storefront — o‘sha teg.
3. RabbitMQ `_v2` dan qaytish kerak bo‘lsa — `ops:rmq-dlq-replay` va eski navbatlar (BE-02 runbook).
4. Qaytgandan keyin yangi bazada yaratilgan test ma’lumoti saqlanadi (keyingi urinishda `launch-fresh-db.sh` bo‘sh
   bazani talab qiladi — boshqa nom yoki tozalangan baza).
