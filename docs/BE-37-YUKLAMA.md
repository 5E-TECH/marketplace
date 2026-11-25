# BE-37: yuklama sinovi — lid qabul qilish va operator navbati

TZ: T8 «Yuklama» (~13 500 lid/kun, cho‘qqi 2 lid/s × 5 zaxira = 10 lid/s). Kartalar: BE-37 TC1, QA-04 TC1, TC2,
TC4. Bajaruvchi: Dilshod. Parol, token va kalitlar bu faylga, repoga va Trello’ga yozilmaydi.

BE-37 TC2 (pentest topilmalari) bu hujjatga kirmaydi — tashqi pentest EQ-15 ga bog‘liq.

## 1. Vositalar

| Fayl | Nima qiladi |
|---|---|
| `scripts/load-test.mjs leads` | `POST /api/v1/leads` — BE-37 TC1, QA-04 TC1 |
| `scripts/load-test.mjs operators` | 20 operator navbat bilan ishlaydi — QA-04 TC2, TC4 |
| `scripts/load-test-seed.mjs` | sinov uchun mahsulot, narx, qoldiq va sotuvchi sahifasi (stream) |
| `scripts/load-test/` | `load-test.mjs` modullari: `measure.mjs` — o‘lchov yadrosi (so‘rov vaqti, ochiq sikl, xulosa); `common.mjs` — telefon/IP/lid tanasi, sarlavhalar, token, to‘xtash; `preflight.mjs` — XFF va sahifa tekshiruvi; `leads.mjs`, `operators.mjs`, `operator-setup.mjs` — senariylar |
| `scripts/tests/load-test-*.test.mjs` | vositaning o‘z testlari (`npm run test:ops`): `core` — o‘lchov va token, `leads` — TC1 va CLI himoyasi, `operators` — TC2/TC4; soxta server — `load-test-harness.mjs` |

Tashqi paket yo‘q (Node 22 `fetch`); seed — `pg`. Ikkalasi ham faqat lokal stendga (`localhost:3000`, seed uchun
baza ham `localhost`) ishlaydi: boshqa har qanday manzilda — **boshqa lokal port, ya’ni ssh tunnel ham** —
`--allow-remote` so‘raladi. Sinov haqiqiy lid va operator yaratadi va lidlarni yopadi, shuning uchun **prod’da
ishlatilmaydi** — faqat lokal yoki alohida sinov stendida. Qo‘shimcha belgi: ikkala senariy ham boshida
`LOAD_STREAM_CODE` sahifasini tekshiradi — u `OPEN` va mahsuloti `Yuklama-sinov …` bo‘lishi kerak (seed yaratadi,
prod’da bunday mahsulot yo‘q); aks holda hech narsa yaratilmaydi.

**Sinov stendida (`--allow-remote`) — faqat gateway’ning o‘ziga, public domen orqali emas.** Cloudflare va Caddy
orqali gateway haqiqiy klient IP siga ishonadi: sinovning `X-Forwarded-For` i e’tiborsiz qoladi va hamma so‘rov
bitta IP bo‘lib qoladi (3-bo‘lim — `429` va `IP_RATE`). Gateway’ga loopback yoki ichki tarmoqdan ulaning:
- serverning o‘zida, docker tarmog‘i ichidan (`LOAD_BASE_URL=http://api-gateway:3000/api/v1`), yoki
- ssh tunnel: `ssh -o ExitOnForwardFailure=yes -L 13100:<gateway konteyner IP>:3000 <sinov server>` va
  `LOAD_BASE_URL=http://localhost:13100/api/v1 … --allow-remote`. Port **13100**: 3000 — lokal stend, 13000 —
  prod Swagger tunneli (C4.6-RUNBOOK, BE-26). Ochiq qolgan prod tunneli bilan adashmaslik uchun
  `ExitOnForwardFailure=yes` — port band bo‘lsa ssh ulanmaydi.

Skript buni boshida o‘zi tekshiradi: ikki xil, hali ishlatilmagan IP bilan `GET /landing/xff-probe` (404, lid
yaratmaydi) — XFF hisobga olinsa, har biri o‘z hisobida birinchi: `X-RateLimit-Remaining = X-RateLimit-Limit − 1`.
Aks holda — chiqish kodi `2`, birorta lid yuborilmaydi.

**Sozlamalar (environment):**

| O‘zgaruvchi | Sukut | Izoh |
|---|---|---|
| `LOAD_BASE_URL` | `http://localhost:3000/api/v1` | gateway manzili |
| `LOAD_DURATION_SEC` | `600` | davomiyligi |
| `LOAD_RATE` | `10` | `leads`: lid/s (≤ 100) |
| `LOAD_P95_MS` | `300` / `1000` | chegara: `leads` / `operators` |
| `LOAD_STREAM_CODE` | — | ikkala senariyga majburiy (seed chiqaradi) |
| `LOAD_REGION_SOATO`, `LOAD_DISTRICT_SOATO` | `1726`, `1726266` | geo keshdagi kodlar (seed chiqaradi) |
| `LOAD_OPERATORS` | `20` | `operators`: operatorlar soni |
| `LOAD_OPERATOR_PAUSE_MS` | `1000` | lidni yopgandan keyin keyingisigacha tanaffus |
| `LOAD_ADMIN_PHONE`, `LOAD_ADMIN_PASSWORD` | — | SUPERADMIN: operatorlarni yaratadi (`POST /admin/team`) |
| `LOAD_OPERATOR_PASSWORD` | — | yaratiladigan operatorlar paroli (≥ 8) |
| `LOAD_OPERATOR_PHONE_PREFIX` | `+998991000` | operator telefonlari: prefiks + `001`…`020` |
| `LOAD_MAX_INFLIGHT` | `200` | bir vaqtda ochiq so‘rovlar chegarasi |
| `LOAD_TIMEOUT_MS` | `10000` | bitta so‘rov |
| `LOAD_REPORT_FILE` | — | yakuniy JSON hisobot (`0600`) — Trello izohi uchun dalil |

Chiqish kodi: `0` — o‘tdi, `1` — o‘tmadi, `2` — foydalanish yoki tayyorgarlik xatosi: sahifa OPEN emas yoki
yuklama mahsulotiniki emas, gateway XFF ni hisobga olmayapti, kirish bo‘lmadi (2FA, token yo‘q), navbat sinov uchun
bo‘sh emas, `LOAD_REPORT_FILE` ga yozib bo‘lmaydi va h.k. Sahifa, hisobot fayli, XFF, admin kirishi va navbat holati
birinchi lid yoki operator yaratilishidan **oldin** tekshiriladi. Operatorlarni tayyorlash (yaratish, kirish,
`ONLINE`) yarmida xato bo‘lsa — yaratilganlari bazada qoladi, `ONLINE` bo‘lib ulgurganlari `OFFLINE` qilinadi.

**To‘xtatish.** Ctrl+C yoki `SIGTERM`: yangi lid yuborilmaydi/olinmaydi, operatorlar qo‘lidagi sinov lidini yopib
`OFFLINE` bo‘ladi, qisman hisobot yoziladi (`… bilan to‘xtatildi`, chiqish kodi `1`). Ikkinchi Ctrl+C — darhol
chiqish (shunda operatorlar `ONLINE`, lidlar 10 daqiqagacha bronda qolishi mumkin).

Login tokeni javob tanasidan (`AUTH_TOKENS_IN_BODY=true`, sukut) yoki `accessToken` cookie’sidan
(`AUTH_TOKENS_IN_BODY=false`, prod) olinadi va `Authorization: Bearer` bilan yuboriladi. Sinov akkauntlarida 2FA
bo‘lmasligi kerak.

## 2. Nima o‘lchanadi va qachon «o‘tdi»

**Ochiq sikl.** Lidlar jadval bo‘yicha ketadi: `i`-lid `start + i / LOAD_RATE` da, oldingi javobni kutmasdan.
Kechikish rejalashtirilgan vaqtdan javob tanasi to‘liq o‘qilguncha o‘lchanadi — server sekinlashsa, navbatda kutgan
vaqt ham hisobga kiradi (coordinated omission yo‘q). So‘rov rejadan oldin ketmaydi (Node taymeri yuklama ostida erta
uyg‘onsa, reja kelguncha qayta kutadi). Ochiq so‘rovlar `LOAD_MAX_INFLIGHT` ga yetsa, yangisi yuborilmaydi va
`overload` xatosi yoziladi — u kechikishga ham, `achievedRate` ga ham kirmaydi (`achievedRate` — haqiqatda
yuborilganlar / yuborish oynasi). Yuborilgan har so‘rov — `timeout` va tarmoq xatosi ham, o‘lchangan vaqti bilan —
p50…max ga kiradi. p95 — nearest-rank.

**TC1 (`leads`).** Muvaffaqiyat — faqat `201` va `data.duplicate === false` va `data.leadId !== '0'`. `duplicate`
(MERGED), `honeypot` (`leadId '0'`), har qanday 4xx/5xx, `timeout` va `overload` — xato. O‘tdi = 0 xato, p95 <
300 ms va `LOAD_RATE × LOAD_DURATION_SEC` ta so‘rov yuborilgan. Boshlashdan oldin `GET /landing/<kod>`: `OPEN`
bo‘lmasa yoki mahsulot nomi `Yuklama-sinov` bilan boshlanmasa (noto‘g‘ri kod haqiqiy mahsulotga minglab lid
yozardi) — sinov boshlanmaydi.

API javobi IP qoidasini ko‘rsatmaydi: `IP_RATE` bilan ushlangan lid ham `201, duplicate: false` qaytaradi. Shuning
uchun TC1 dan keyin bazada majburiy tekshiruv (`<run>` — hisobotdagi `leads.sub1`):
```sql
SELECT status, review_reason, merged_into_id IS NOT NULL AS merged, count(*)
FROM lead.lead WHERE sub1 = 'loadtest-<run>' GROUP BY 1, 2, 3;
-- kutilgan: bitta qator — NEW, NULL, false, LOAD_RATE × LOAD_DURATION_SEC
```

**TC2 (`operators`).** Boshida admin bilan `GET /operator/queue-summary`: muddati kelgan qayta qo‘ng‘iroq yoki bron
bo‘lsa, yoki yangi lid operatorlardan kam bo‘lsa — sinov boshlanmaydi (pastda «Himoya»). Har operator:
`PUT /operator/state ONLINE`, keyin sikl — `POST /operator/leads/next` (javobning o‘zi lid kartasi), FE-08 ekrani
ochadigan 5 ta GET **bir vaqtda** (SPA kabi): `GET /operator/leads/:id`, `/operator/leads/:id/product`,
`/operator/leads`, `/operator/state`, `/operator/queue-summary`, oxirida
`POST /operator/leads/:id/result {outcome: INVALID}`. p95 < 1000 ms har so‘rov turiga alohida **va** butun ekranga:
`ekran: keyingi lid + 5 GET (parallel)` = `next` + eng sekin GET — «lid kartasi 1 s da ochiladi». Bo‘sh navbat
(`404 LEAD_QUEUE_EMPTY`) xato emas — 1 s kutib qayta so‘raydi va alohida sanaladi; lekin bo‘sh javoblar olingan
lidlardan ko‘p bo‘lsa — o‘tmadi (operatorlar yuklamasiz turgan, o‘lchov hech narsani ko‘rsatmaydi). Hisobotdagi
`queueFirstEmptyAtSec` — navbat birinchi marta qachon bo‘shagani: undan keyingi vaqt yuklamasiz, «o‘tdi» faqat shu
vaqtgacha bo‘lgan yuklamani ko‘rsatadi. Oxirida hamma sinov operatori `OFFLINE` qilinadi.

**TC4.** Boshida 20 operator «Keyingi lid» ni bir vaqtda bosadi — 20 ta turli lid olishi kerak. Keyin butun sinov
davomida har olingan lid ID si yoziladi: bitta ID ikki marta (ikki operatorga yoki bitta operatorga ikki marta)
chiqsa — o‘tmadi. Bazada qo‘shimcha tekshiruv (5-bo‘lim).

**Himoya.** `operators` faqat ismi `Yuklama-sinov` bilan boshlanadigan lidlarni yopadi. Navbatdan boshqa lid chiqsa
— yopilmaydi va hamma operator yangi lid olishni to‘xtatadi (qo‘lidagi sinov lidini yopib). Yangi (`NEW`) begona lid
bron muddati (10 daqiqa) tugagach o‘zi navbatga qaytadi. Muddati kelgan qayta qo‘ng‘iroq esa bron tugagach **sinov
operatorida qolib ketardi** (`lead-queue.service.ts`, 4-qoida: egasi bor qayta qo‘ng‘iroq egasida qoladi, egasi —
oxirgi bron qilgan operator) — shuning uchun boshida `dueCallbacks = 0` va `booked = 0` talab qilinadi. Sinov
davomida muddati kelib qolgan qayta qo‘ng‘iroqdan bu himoya qilmaydi: haqiqiy qayta qo‘ng‘iroqlar bor bazada sinov
o‘tkazilmaydi. Hisobot va chiqishda javob tanasi, parol, token va cookie yo‘q — xato namunasida faqat status,
`errorCode`, `requestId`.

**Seed.** `LOAD_DATABASE_URL` ham `localhost` bo‘lishi kerak (`?host=` yoki bo‘sh host — lokal emas; noto‘g‘ri URL
xabarga chiqmaydi, ichida parol bor). SQL yozishdan oldin baza aynan shu API ning bazasi ekani tekshiriladi: API
hozirgina yaratgan mahsulot nomi `catalog.product` da ham shunday bo‘lishi kerak.

## 3. Nega har lidga alohida IP va telefon

Bitta IP dan 10 lid/s TC1 ni hech qachon o‘tkazmaydi — bu tizimning to‘g‘ri ishlashi:
- gateway limiti: route × IP ga 300 so‘rov/daqiqa (`RATE_LIMIT_MAX`) — 10 lid/s da ~30 s dan keyin `429`;
- BE-12 IP qoidasi: bitta IP dan 10 daqiqada 6-lid va keyingilari `201` qaytaradi, lekin `review_reason='IP_RATE'`
  bilan operator navbatiga tushmaydi (fraud hodisasi ochiladi);
- dublikat: bir telefon + mahsulot 30 kun ichida — MERGED (`duplicate: true`).

Haqiqiy pilotda har lid boshqa mijozdan keladi, shuning uchun sinov ham shunday: har lidga alohida
`X-Forwarded-For` (`2001:db8::/32`, hujjatlar uchun ajratilgan, ishonchli tarmoq emas) va noyob telefon
(`+998` + 90/91/93/94/95/97/98/99 + 7 raqam; boshlanish nuqtasi vaqtdan — ketma-ket yugurishlar ~9 kun kesishmaydi).
Gateway `trust proxy` loopback/ichki tarmoqdan kelgan XFF ga ishonadi (`trust-proxy.ts`), shuning uchun lokalda
`req.ip` shu manzil bo‘ladi. Prod’da XFF ni Cloudflare va Caddy yozadi — tashqaridan uni almashtirib bo‘lmaydi;
shuning uchun public domen orqali bu sinov bo‘lmaydi (1-bo‘lim, XFF tekshiruvi).
`--single-ip` — limit va IP qoidasini ko‘rsatish uchun: namoyish rejimi, hech qachon «o‘tdi» bermaydi (`IP_RATE`
ushlagan lid ham `201` qaytaradi, natija faqat bazada ko‘rinadi). Lokalda 40 s × 10 lid/s bitta IP
dan: 300 ta `201`, keyin 100 ta `429`; 300 lidning 5 tasi toza, 295 tasi `IP_RATE`, 1 ta fraud hodisasi.

## 4. Lokal stend

Hammasi vaqtinchalik papkada (`<stend>`), repo `.env` ishlatilmaydi.

1. Postgres 16 va RabbitMQ 3.13 (alohida baza va vhost), MinIO (`file-service` uchun). Prod bilan bir xil:
   Postgres sukut sozlamalari (`max_connections=100`), Redis yo‘q (limit xotirada), `RATE_LIMIT_MAX` sukut (300).
2. `<stend>/.env`: `NODE_ENV=development`, `DB_*`, `RABBITMQ_URL`, `MINIO_*`, tasodifiy `JWT_SECRET`,
   `JWT_REFRESH_SECRET`, `INTEGRATION_CREDENTIAL_SECRET`, `ELCHI_WEBHOOK_SECRET`, `SEED_ADMIN_PHONE`,
   `SEED_ADMIN_PASSWORD`. **`ELCHI_PARTNER_API_URL` — lokal stubga** (`GET /partner/regions`, `/partner/districts`,
   `/partner/tariff`, `POST /partner/markets` — ~20 qator `node:http`); `.env.example` dagi haqiqiy Elchi manzili
   qo‘yilmaydi. `DB_USERNAME_<SXEMA>` qo‘yilmaydi (bitta foydalanuvchi, auto-migrate).
3. `node --env-file=<stend>/.env scripts/migrate.mjs run --dist`, keyin `check --dist`.
4. 12 servis `dist` dan, joriy papka `<stend>` (`.env` shu yerdan o‘qiladi):
   `node <repo>/dist/apps/<servis>/apps/<servis>/src/main.js`. `GET /api/v1/health/readiness` → 200.
5. Seed:
   ```sh
   LOAD_DATABASE_URL=postgresql://<user>:<parol>@127.0.0.1:<port>/<baza> \
   LOAD_ADMIN_PHONE=... LOAD_ADMIN_PASSWORD=... node scripts/load-test-seed.mjs
   ```
   Admin API orqali optovik → mahsulot (MXIK va qadoq kodi bilan, BE-41) → tasdiq → tavsiya narx (GREEN) → HQ
   omborga 1 000 000 dona. SQL bilan faqat variant ID va `lead.stream` qatori (API orqali sahifa ochish OTP bilan
   ro‘yxatdan o‘tgan sotuvchi va VIDEO kreativ talab qiladi; lid qabul qilish ularni tekshirmaydi). Geo kesh
   bo‘sh bo‘lsa `GET /regions/tree` uni stubdan to‘ldiradi. Oxirida `OPEN` tekshiriladi va
   `LOAD_STREAM_CODE`, `LOAD_REGION_SOATO`, `LOAD_DISTRICT_SOATO` qatorlari chiqadi.
6. Sinovlar:
   ```sh
   LOAD_STREAM_CODE=... LOAD_REPORT_FILE=tc1.json node scripts/load-test.mjs leads          # TC1, 10 daqiqa
   LOAD_STREAM_CODE=... LOAD_ADMIN_PHONE=... LOAD_ADMIN_PASSWORD=... LOAD_OPERATOR_PASSWORD=... \
     LOAD_DURATION_SEC=300 LOAD_REPORT_FILE=ops.json node scripts/load-test.mjs operators     # TC2, TC4
   ```
   Operator senariysidan oldin navbatda yetarli toza NEW lid bo‘lsin: kamida `LOAD_OPERATORS` ta (aks holda
   boshlanmaydi). 20 operator ~15.6 lid/s yopadi: 300 s ga ~4700 ta, sukutdagi 600 s ga ~9400 ta kerak (TC1 dan
   keyin 6000 ta bo‘ladi — shuning uchun 300 s). Lid yetmasa navbat bo‘shaydi: hisobotdagi `queueFirstEmptyAtSec`
   shuni ko‘rsatadi, bo‘sh javoblar olinganlardan ko‘p bo‘lsa — «o‘tmadi». TC1 va `operators` ni bir vaqtda ishga
   tushirish — aralash yuklama (5-bo‘lim).

Sinov lidlari: `sub1 = 'loadtest-<run>'`, `utm_source = 'loadtest'`, ism `Yuklama-sinov …`. Operatorlar: ism
`Yuklama-sinov operator N`, telefon `LOAD_OPERATOR_PHONE_PREFIX` + `NNN` (keyingi yugurishda qayta ishlatiladi —
`409` → o‘sha parol bilan kiradi). Stend o‘chirilganda bularning hammasi bazasi bilan ketadi.

## 5. Natija

**Tekshirilgan (2026-11-25, lokal: Node 22.22.1, PostgreSQL 16.14, RabbitMQ 3.13.7, 12 servis `dist` dan, bitta
gateway, Redis yo‘q, `RATE_LIMIT_MAX=300`, 8 CPU / 6.6 GiB; yuklama generatori ham shu kompyuterda). Hamma qator —
skriptning yakuniy versiyasi bilan:**

| TC | Sinov | Natija |
|---|---|---|
| BE-37 TC1, QA-04 TC1 | 10 lid/s × 600 s: 6000/6000 so‘rov, 0 xato; p50 45.2 ms, p95 **53.2 ms**, p99 67 ms, max 143 ms | PASS |
| QA-04 TC1 (aralash) | 10 lid/s × 300 s, bir vaqtda 20 operator ishlaydi: 3000/3000, 0 xato; p50 86.2 ms, p95 **165.4 ms**, p99 225.2 ms, max 528 ms | PASS |
| QA-04 TC2 | 20 operator × 300 s, 4681 lid yopildi, 0 xato. p95: `next` (kartochka) **201.8 ms**, `GET leads/:id` 179.5, `…/product` 151.7, `GET leads` 174.3, `state` 101.7, `queue-summary` 99.7, `result` 104.6 ms. Butun ekran (`next` + 5 ta parallel GET ning eng sekini): p50 212 ms, p95 **367 ms**, p99 613 ms, max 1204 ms | PASS |
| QA-04 TC4 | Bir vaqtdagi 20 ta «Keyingi lid» → 20 ta turli lid; 300 s da 4681 olish, takror 0 | PASS |

Bazadagi tekshiruv:
- TC1: 6000 lid, hammasi `NEW`, `review_reason` yo‘q, MERGED yo‘q, 6000 noyob telefon; yugurish davomida
  `fraud_incident` 0; lead-service va gateway jurnalida xato yo‘q.
- Aralash: 3000 lid, 3000 noyob telefon, `review_reason` yo‘q, MERGED yo‘q; hammasini operatorlar `INVALID` bilan
  yopgan. Yugurish oxirida `BOOKED` 0, `CALLBACK` 0, 20 operator `OFFLINE`.
- TC4: `lead_history` da `→ BOOKED` o‘tishlari — 4681 yozuv, 4681 turli lid, 20 operator; bir lid ikki marta — 0
  (`SELECT lead_id … WHERE to_status = 'BOOKED' … GROUP BY lead_id HAVING count(*) > 1` bo‘sh).
- `fraud_incident`: `SPAM_IP`/`IP_RATE` yo‘q. Soatlik sifat tekshiruvi (BE-12) ikkala sinov sahifasiga `QUALITY`
  (`WARN`) ochdi — «yaroqli lid 0%», chunki sinov hamma lidni `INVALID` yopadi. Bu kutilgan; sahifa to‘xtatilmaydi
  (`ACTIVE` qoldi). Sinov stendida supervizor ekranida ko‘rinadi — sinovdan keyin yopib qo‘ying.
- Xotira: 12 servis jami 1.11–1.26 GB RSS (aralash 300 s, har 10 s), o‘smadi. Kompyuter yuklamasi (load average)
  8 CPU da ~8.4 gacha chiqdi.
- `AUTH_TOKENS_IN_BODY=false` (prod) rejimidagi ikkinchi gateway orqali ham tekshirildi: seed va 20 operator × 15 s —
  token `accessToken` cookie’sidan olindi, preflight o‘tdi, oxirida hammasi `OFFLINE`.

Avtomat testlar: `scripts/tests/load-test-*.test.mjs` (32 ta, `npm run test:ops`) — p95 hisobi va `overload` ning
p50/tezlikka kirmasligi, ochiq sikl tezligi (rejadan erta yubormaslik), kechikish rejalashtirilgan vaqtdan, timeout
va tarmoq xatosi, tana yoki cookie’dagi token, noyob telefon/IP, DTO maydonlari, xato turlari va chiqish kodi, javob
tanasi va parol chiqmasligi, localhost himoyasi, XFF tekshiruvi, yuklama mahsuloti va hisobot fayli tekshiruvi,
navbat tayyorgarligi, ekran vaqti (parallel GET), TC4 takrorni topish, begona lidni yopmaslik va qo‘ldagi sinov
lidini yopish, oxirida va tayyorgarlik xatosida `OFFLINE`.

**Izohlar:**
- Bu lokal dalil, prod emas. Prod’da servislar konteynerda, Caddy va Cloudflare Tunnel orqali; o‘sha yerda bir xil
  o‘lchov uchun sinov stendi kerak (prod’ga sinov lidlari yuborilmaydi).
- Aralash sinov ataylab og‘ir: operator lidni ~1.3 s da yopadi (haqiqiy ish — daqiqalar), ya’ni ~15.6 lid/s chiqim
  va ~110 so‘rov/s operator trafigi. Shunda ham chegaradan ancha past. Boshlanishdagi 20–30 s da (sovuq start va 20 ta
  bir vaqtdagi so‘rov) lid p95 ~300 ms gacha chiqdi, keyin pasaydi; qisqa (15 s) yugurish shuning uchun ko‘p narsa
  ko‘rsatmaydi — kamida 300 s.
- Ekran vaqti 5 ta GET parallel deb hisoblanadi (SPA shunday ochadi). FE-08 ularni ketma-ket yuborsa, ekran vaqti
  taxminan yig‘indiga teng bo‘ladi — FE-08 tayyor bo‘lgach brauzer tarmoq panelida tekshirish kerak.
- [taklif] keyingi tezlashtirish (hozir shart emas): `LeadIntakeService.create` da `catalog.offer.get` va geo
  `resolve-address` RPC larini parallel chaqirish; postback/CAPI enqueue da streamni qayta o‘qimaslik.
- Postgres `max_connections=100`, har servis pool’i sukut 10 — 10 ta DB servisi to‘liq yuklansa chegaraga yetadi.
  10 lid/s da ulanishlar soni kam; gateway yoki servislar ko‘paytirilsa (BE-36) pool yoki `max_connections`
  hisoblanadi.
