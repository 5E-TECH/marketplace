# Elchi Marketplace — Trello Board (task breakdown + deadline + testlar)

> To'liq PRD: [`MARKETPLACE_PLAN.md`](./MARKETPLACE_PLAN.md) · Elchi kontrakt: `../../Elchi-Backend/docs/PARTNER_API.md`
> Har card = bitta task: **tavsif + acceptance checklist + 🧪 test-case + assignee + deadline + bog'liqlik**.
> Test-case = "qadam → kutilgan natija". Task shu testlardan **o'tsa** Done. Bulk import: [`trello-import.csv`](./trello-import.csv).

Holat: **DRAFT** · Boshlanish: 2026-07-20 (Dushanba) · **Ish rejimi: Dushanba–Juma** (Shanba/Yakshanba dam).

---

## 0. Jamoa

| Kod | Kim | Mas'uliyat sohasi |
|---|---|---|
| **L** | Siz (Team Lead / full-stack) | Monorepo, `libs/common`, api-gateway, identity, **Elchi Partner API + elchi-integration**, code review, deploy |
| **D** | **Dilshodbek** (Backend dasturchi) | inventory, catalog, checkout/cart, payment, finance, notification, search, file-service |
| **B** | **Bahodir** (Frontend dasturchi) | seller-cabinet (React), storefront (Next.js), admin UI, dizayn |

> L barcha PR'larni review qiladi va **har card testlaridan o'tganini tasdiqlaydi** (Review→Done).

---

## 1. Trello board sozlash

**Lists:** `📥 Backlog → 📋 Sprint → 🔨 In Progress → 👀 Review / QA → ✅ Done`
**Labels:** Faza(0–4) · Soha(Backend-Core/Backend-Commerce/Frontend/Elchi-Integration/DevOps) · Prioritet(🔴Blocker/🟠High/🟡Normal) · Hajm(XS/S/M/L)
**Members:** Lead, Dilshodbek, Bahodir. **Deadline:** eng qiyin task max 3 kun; faqat ish kunlari.

**Definition of Done (DoD) — har card uchun umumiy:**
- [ ] Acceptance checklist to'liq bajarilgan
- [ ] **🧪 Card ichidagi `🧪 Test (Done'dan oldin)` checklistidagi BARCHA punkt ✓ belgilangan** —
      dasturchi har testni **qo'lda bajarib ko'radi** va belgilaydi (backend: avtomat test ham yashil;
      frontend: qo'lda QA). **Checklist 100% (masalan 6/6) bo'lmasa card Done'ga o'tmaydi.**
- [ ] PR ochilgan, L review qilgan, `main`ga merge
- [ ] Swagger/README yangilangan (kerak bo'lsa)

> **Qoida:** har cardda TC1/TC2… testlari Trello checklisti sifatida turadi. Reviewer (L) ham
> merge'dan oldin checklist to'liq ✓ ekanini tekshiradi. Yarim bajarilgan checklist = card Done EMAS.

---

## 2. Umumiy jadval

| Faza | Nomi | Muddat | Natija |
|---|---|---|---|
| **0** | Poydevor + setup | 2026-07-20 → 08-03 | Trello, dizayn, monorepo, libs, identity, **inventory yashil test** |
| **1 ⭐** | Sotuvchi kabineti (MVP) | 2026-08-03 → 08-31 | Ro'yxat→approve→mahsulot+variant+sklad; Elchi market provision |
| **2** | Storefront + checkout | 2026-08-31 → 09-22 | Vitrina, savat, checkout split, Elchi shipment + webhook |
| **3** | Online to'lov | 2026-09-16 → 09-29 | Payme/Click, escrow payout, komissiya |
| **4** | Sayqal + deploy | 2026-09-30 → 10-12 | Review, refund, COD recon, analytics, deploy |

> **Realistik yakuniy sana: ~2026-10-12.** §4 optimizatsiyasi bilan tezroq bo'lishi mumkin.

---

## FAZA 0 — Poydevor + setup  ·  2026-07-20 → 08-03

### 🟣 Setup (birinchi 2 kun)

#### C0.0a — Trello board yaratish + cardlarni ko'chirish
- **Assignee:** D · **Labels:** Phase 0, DevOps, 🟠 High · **Hajm:** M (2 kun) · **Deadline:** 2026-07-21 · **Bog'liqlik:** —
- **Tavsif:** Ushbu rejani real Trello board'ga ko'chirish. (Bu kunlarda monorepo hali tayyor emas — vaqt mos.)
- **Acceptance:** [ ] Board + 5 list · [ ] barcha labellar · [ ] `trello-import.csv` import · [ ] har card member+label+due · [ ] jamoa taklif qilindi
- **🧪 Testlar:**
  - TC1: Board ochilganda 5 ta list (Backlog→Done) ko'rinadi.
  - TC2: Trello'dagi card soni = CSV qatorlari soni (~70) — hech biri tushib qolmagan.
  - TC3: Tasodifiy 5 card tekshiriladi → har birida member, kamida 2 label, due date bor.
  - TC4: Dilshodbek va Bahodir board'ga kirib, o'z cardlarini ko'ra oladi.

#### C0.0b — Sayt uchun dizayn topish / tanlash
- **Assignee:** B · **Labels:** Phase 0, Frontend, 🟠 High · **Hajm:** M (2 kun) · **Deadline:** 2026-07-21 · **Bog'liqlik:** —
- **Tavsif:** Storefront va seller-cabinet vizual yo'nalishi: UI kit, referens, palitra/tipografiya. Keyingi UI ishiga poydevor.
- **Acceptance:** [ ] 2–3 referens tahlil · [ ] UI kit/design system tanlandi · [ ] palitra/tipografiya · [ ] asosiy ekran mockup · [ ] L tasdiq
- **🧪 Testlar:**
  - TC1: Kamida 4 ta ekran mockup mavjud (bosh sahifa, product, checkout, cabinet dashboard).
  - TC2: Rang palitrasi (hex kodlar) va tipografiya (font nomlari/o'lchamlari) hujjatlashtirilgan — kodda to'g'ridan ishlatsa bo'ladi.
  - TC3: Tanlangan UI kit (antd theme yoki Figma) jamoaga havola bilan ulashilgan.
  - TC4: L "approve" bergan (Trello card izohida yoki checklist).

### 🔵 L (Lead)

#### C0.1 — Monorepo init + Docker infra
- **Assignee:** L · **Labels:** Phase 0, DevOps, 🔴 Blocker · **Hajm:** M (2 kun) · **Deadline:** 2026-07-21 · **Bog'liqlik:** —
- **Tavsif:** Git repo + NestJS monorepo (nest-cli). `docker-compose`: Postgres, RabbitMQ, MinIO, Adminer. `.env.example` + config.
- **Acceptance:** [ ] repo+.gitignore(.env) · [ ] nest-cli monorepo (apps/, libs/) · [ ] docker-compose 4 servis · [ ] .env.example + Joi config · [ ] README dev-setup
- **🧪 Testlar:**
  - TC1: `docker compose up` → postgres, rabbitmq, minio, adminer konteynerlari `healthy` bo'ladi.
  - TC2: `npm run start:dev` → gateway xatosiz ko'tariladi.
  - TC3: Majburiy env kaliti o'chirilsa → ilova Joi validatsiya xatosi bilan to'xtaydi (config ishlayapti).
  - TC4: `.env` git'ga qo'shilmaydi (`git status` da ko'rinmaydi).

#### C0.2 — libs/common port
- **Assignee:** L · **Labels:** Phase 0, Backend-Core, 🔴 Blocker · **Hajm:** L (3 kun) · **Deadline:** 2026-07-24 · **Bog'liqlik:** C0.1
- **Tavsif:** Elchi patternlarini ko'chirish — marketplace poydevori.
- **Acceptance:** [ ] BaseEntity(soft-delete) · [ ] response envelope + exception filter · [ ] executeAndAck · [ ] idempotency+outbox · [ ] activity-log · [ ] JWT/Roles/Self guards · [ ] numericTransformer+enums · [ ] SSRF+HMAC helper
- **🧪 Testlar:**
  - TC1: Har HTTP javob `{statusCode, message, data}` formatida (namuna endpoint).
  - TC2: Xato tashlansa → filter to'g'ri statusCode + envelope qaytaradi (500 leak yo'q).
  - TC3: JwtAuthGuard: tokensiz → 401; RolesGuard: noto'g'ri rol → 403.
  - TC4: numericTransformer: `10.005` saqlab o'qilganda `10.01` (2 knoq), drift yo'q.
  - TC5: idempotency: bir xil kalit bilan 2 marta yozuv → DB'da 1 ta yozuv.
  - TC6: outbox: event yozilib, "yuborilmagan" holatida qoladi va relay uni bir marta yuboradi (unit test).

#### C0.3 — api-gateway skeleton
- **Assignee:** L · **Labels:** Phase 0, Backend-Core, 🟠 High · **Hajm:** S (1 kun) · **Deadline:** 2026-07-27 · **Bog'liqlik:** C0.2
- **Acceptance:** [ ] ClientProxy RMQ · [ ] global pipe/interceptor/filter · [ ] JWT+Roles · [ ] Swagger + health
- **🧪 Testlar:**
  - TC1: `GET /health` → 200.
  - TC2: `/api/docs` (Swagger) brauzerda ochiladi.
  - TC3: Himoyalangan route tokensiz → 401.
  - TC4: gateway RMQ orqali test-servisga so'rov yuborib, javob oladi (echo/ping).

#### C0.4 — identity-service
- **Assignee:** L · **Labels:** Phase 0, Backend-Core, 🔴 Blocker · **Hajm:** L (3 kun) · **Deadline:** 2026-07-30 · **Bog'liqlik:** C0.2
- **Acceptance:** [ ] user entity(rol/phone/hash) · [ ] register/login(bcrypt+JWT) · [ ] refresh/uzoq access · [ ] get_by_id/find · [ ] roles seed + gateway route
- **🧪 Testlar:**
  - TC1: `POST /auth/register` → user yaratiladi; DB'da parol **hash** (plain emas).
  - TC2: `POST /auth/login` to'g'ri parol → JWT qaytadi; decode'da `sub` va `role` bor.
  - TC3: Login noto'g'ri parol → 401.
  - TC4: Dublikat phone bilan register → 409/xato.
  - TC5: JWT bilan himoyalangan endpoint → 200; muddати o'tgan/soxta token → 401.

#### C0.5 — CI/CD + lint + dev docs
- **Assignee:** L · **Labels:** Phase 0, DevOps, 🟡 Normal · **Hajm:** S (1 kun) · **Deadline:** 2026-07-31 · **Bog'liqlik:** C0.1
- **Acceptance:** [ ] ESLint+Prettier+husky · [ ] Actions(lint/build/test) · [ ] CONTRIBUTING + README
- **🧪 Testlar:**
  - TC1: Ataylab lint xatosi bilan PR → CI **qizil**.
  - TC2: Toza PR → CI **yashil** (lint+build+test bosqichlari ko'rinadi).
  - TC3: Lint xatosi bilan commit → husky pre-commit bloklaydi.

### 🟢 D (Dilshodbek — Backend)

#### C0.6 — catalog-service entities
- **Assignee:** D · **Labels:** Phase 0, Backend-Commerce, 🟠 High · **Hajm:** M (2 kun) · **Deadline:** 2026-07-23 · **Bog'liqlik:** C0.1
- **Acceptance:** [ ] shop · [ ] category(tree) · [ ] product · [ ] product_variant · [ ] migratsiyalar
- **🧪 Testlar:**
  - TC1: Migratsiya ishga tushadi → `catalog_schema`da 4 jadval mavjud (Adminer'da ko'rinadi).
  - TC2: Ikki shop bir xil `slug` bilan → unique violation.
  - TC3: Ikki variant bir xil `sku` bilan → unique violation.
  - TC4: category `parent_id` bilan yoziladi va daraxt sifatida o'qiladi.

#### C0.7 — inventory-service entities
- **Assignee:** D · **Labels:** Phase 0, Backend-Commerce, 🔴 Blocker · **Hajm:** S (1 kun) · **Deadline:** 2026-07-24 · **Bog'liqlik:** C0.1
- **Acceptance:** [ ] warehouse · [ ] stock(uniq) · [ ] stock_movement · [ ] reservation+item · [ ] migratsiyalar
- **🧪 Testlar:**
  - TC1: Migratsiya → jadvallar `inventory_schema`da.
  - TC2: Bir `(variant_id, warehouse_id)` 2-marta stock → unique violation.
  - TC3: reservation `order_ref` unique — takror → xato.

#### C0.8 — Inventory reserve/commit/release/inbound/adjust  ⭐
- **Assignee:** D · **Labels:** Phase 0, Backend-Commerce, 🔴 Blocker · **Hajm:** L (3 kun) · **Deadline:** 2026-07-29 · **Bog'liqlik:** C0.7, C0.2
- **Tavsif:** Marketplace yuragi — oversell'ni imkonsiz qiluvchi rezervatsiya.
- **Acceptance:** [ ] reserve(FOR UPDATE) · [ ] commit · [ ] release · [ ] inbound · [ ] adjust · [ ] invariant · [ ] idempotency
- **🧪 Testlar (kengaytirilgan — kritik):**
  - TC1: on_hand=10, reserve 5 → reserved=5, available=5; `movement(reserve)` yozildi.
  - TC2: on_hand=10, reserve 20 → **THROW** "yetarli emas"; holat o'zgarmaydi (reserved=0).
  - TC3: reserve 5 → commit → on_hand=5, reserved=0; `movement(commit)`.
  - TC4: reserve 5 → release → reserved=0, on_hand=10 (tiklandi); `movement(release)`.
  - TC5: inbound 10 (on_hand=5) → on_hand=15; `movement(inbound)`.
  - TC6: **Invariant:** har amaldan keyin `on_hand − reserved ≥ 0` (hech qachon manfiy emas).
  - TC7: **Idempotency:** bir xil `idempotency_key` bilan reserve 2 marta → reserved faqat 1 marta oshadi.
  - TC8: adjust −3 (sabab bilan) → on_hand −3; movement(adjust, actor yozilgan).

#### C0.9 — Reservation TTL sweeper + out_of_stock event
- **Assignee:** D · **Labels:** Phase 0, Backend-Commerce, 🟠 High · **Hajm:** S (1 kun) · **Deadline:** 2026-07-30 · **Bog'liqlik:** C0.8
- **Acceptance:** [ ] cron sweeper(expired→release) · [ ] on_hand=0 → out_of_stock event
- **🧪 Testlar:**
  - TC1: `expires_at` o'tgan `held` reservation → sweeper ishlagach `released`, reserved qaytadi.
  - TC2: Muddати o'tmagan reservation → sweeper tegmaydi.
  - TC3: commit natijasida on_hand=0 → `stock_depleted` event chiqadi → catalog product `out_of_stock`.

#### C0.10 — Inventory testlar
- **Assignee:** D · **Labels:** Phase 0, Backend-Commerce, 🔴 Blocker · **Hajm:** M (2 kun) · **Deadline:** 2026-08-03 · **Bog'liqlik:** C0.8, C0.9
- **Tavsif:** Bu card'ning o'zi test — Faza 0 qabul mezoni.
- **Acceptance:** [ ] happy-path · [ ] oversell imkonsiz · [ ] concurrency · [ ] idempotency · [ ] TTL
- **🧪 Testlar:**
  - TC1: `npm test inventory` → barcha testlar **yashil**, coverage ombor mantig'ini qamraydi.
  - TC2: **Oversell:** on_hand=100, 2 parallel reserve×60 → **bittasi fail**; yakuniy reserved ≤ 100.
  - TC3: **Race:** 50 concurrent reserve×2 (on_hand=100) → yig'indi reserved = 100, 0 ta overshoot.
  - TC4: Idempotency va TTL testlari CI'da avtomat ishlaydi va yashil.

### 🟣 B (Bahodir — Frontend)

#### C0.11 — seller-cabinet project setup
- **Assignee:** B · **Labels:** Phase 0, Frontend, 🟠 High · **Hajm:** S (1 kun) · **Deadline:** 2026-07-22 · **Bog'liqlik:** C0.0b
- **Acceptance:** [ ] Vite+React19+TS+antd+RTK+react-query+router · [ ] papka struktura+eslint+build · [ ] dizayn tokenlari
- **🧪 Testlar:**
  - TC1: `npm run dev` → bo'sh app xatosiz ochiladi.
  - TC2: `npm run build` → xatosiz build.
  - TC3: `npm run lint` → 0 xato.
  - TC4: C0.0b palitrasi antd theme'da qo'llangan (asosiy rang ko'rinadi).

#### C0.12 — Auth foundation (frontend)
- **Assignee:** B · **Labels:** Phase 0, Frontend, 🟠 High · **Hajm:** M (2 kun) · **Deadline:** 2026-07-24 · **Bog'liqlik:** C0.11
- **Acceptance:** [ ] axios interceptor(token/401) · [ ] authSlice+persist · [ ] ProtectedRoute · [ ] react-query provider
- **🧪 Testlar:**
  - TC1: Login token bilan → so'rovlarda `Authorization` header avtomat qo'shiladi.
  - TC2: 401 javob → foydalanuvchi avtomat logout + login sahifasiga.
  - TC3: Token bo'lmasa `ProtectedRoute` → login'ga redirect.
  - TC4: Sahifa refresh → token saqlanadi (persist), foydalanuvchi tizimda qoladi.

#### C0.13 — App layout + design tokens
- **Assignee:** B · **Labels:** Phase 0, Frontend, 🟡 Normal · **Hajm:** M (2 kun) · **Deadline:** 2026-07-28 · **Bog'liqlik:** C0.11
- **Acceptance:** [ ] sidebar+header · [ ] antd theme, responsive · [ ] breadcrumb
- **🧪 Testlar:**
  - TC1: Sidebar navigatsiya menyu ochiladi; sahifalar orasida o'tish ishlaydi.
  - TC2: Header'da user menu → logout ishlaydi.
  - TC3: Mobil o'lchamda (375px) layout buzilmaydi (responsive).

#### C0.14 — Reusable komponentlar
- **Assignee:** B · **Labels:** Phase 0, Frontend, 🟡 Normal · **Hajm:** M (2 kun) · **Deadline:** 2026-07-30 · **Bog'liqlik:** C0.13
- **Acceptance:** [ ] DataTable · [ ] FormModal/ConfirmDialog · [ ] ImageUpload · [ ] StatusTag/MoneyText/EmptyState
- **🧪 Testlar:**
  - TC1: DataTable — pagination, sort, search demo ma'lumotda ishlaydi.
  - TC2: ConfirmDialog — "Ha/Yo'q" callback to'g'ri chaqiriladi.
  - TC3: ImageUpload — rasm tanlanganda preview ko'rinadi; noto'g'ri format rad etiladi.
  - TC4: MoneyText — `1234567` → `1 234 567` formatida.

#### C0.15 — Register + Login sahifalari
- **Assignee:** B · **Labels:** Phase 0, Frontend, 🟠 High · **Hajm:** M (2 kun) · **Deadline:** 2026-08-03 · **Bog'liqlik:** C0.12, C0.4
- **Acceptance:** [ ] Register+validatsiya · [ ] Login · [ ] token→redirect
- **🧪 Testlar:**
  - TC1: Bo'sh forma submit → maydonlar validatsiya xatosini ko'rsatadi.
  - TC2: To'g'ri ma'lumot bilan register → backend'ga so'rov, success xabari.
  - TC3: Login → token saqlanadi → dashboard'ga redirect.
  - TC4: Noto'g'ri parol → xato xabari (kirmaydi).

---

## FAZA 1 — Sotuvchi kabineti (MVP) ⭐  ·  2026-08-03 → 08-31

### 🔵 L — Elchi Partner API + integration

#### C1.1 — Elchi: partner entity'lari + migratsiya
- **Assignee:** L · **Labels:** Phase 1, Elchi-Integration, 🟠 High · **Hajm:** S (1 kun) · **Deadline:** 2026-08-03 · **Bog'liqlik:** —
- **Acceptance:** [ ] partner · [ ] partner_shipment_ref · [ ] migratsiya (state machine tegilmagan)
- **🧪 Testlar:**
  - TC1: Migratsiya → `integration_schema`da `partner`, `partner_shipment_ref` jadvallari.
  - TC2: Mavjud Elchi testlari (order/logistics) hamon **yashil** (regressiya yo'q).
  - TC3: partner.secret DB'da ochiq matnda emas (AES) — yozib o'qib tekshiriladi.

#### C1.2 — Elchi: PartnerApiKeyGuard + gateway skeleton
- **Assignee:** L · **Labels:** Phase 1, Elchi-Integration, 🔴 Blocker · **Hajm:** M (2 kun) · **Deadline:** 2026-08-05 · **Bog'liqlik:** C1.1
- **Acceptance:** [ ] X-Api-Key→validate_key→req.partner · [ ] controller+Swagger · [ ] rate-limit
- **🧪 Testlar:**
  - TC1: To'g'ri `X-Api-Key` → so'rov o'tadi; `req.partner` to'ldiriladi.
  - TC2: Noto'g'ri/bo'sh key → 401.
  - TC3: Rate-limitdan oshiq so'rov → 429.
  - TC4: `/partner/*` JWT bilan emas, faqat API-key bilan ishlaydi.

#### C1.3 — Elchi: partner CRUD + kalit
- **Assignee:** L · **Labels:** Phase 1, Elchi-Integration, 🟡 Normal · **Hajm:** S (1 kun) · **Deadline:** 2026-08-06 · **Bog'liqlik:** C1.2
- **Acceptance:** [ ] create/rotate/activate · [ ] key hash, secret AES · [ ] activity-log
- **🧪 Testlar:**
  - TC1: partner create → key **bir marta** ko'rsatiladi, DB'da hash saqlanadi.
  - TC2: rotate-key → eski key ishlamaydi (401), yangi key ishlaydi.
  - TC3: is_active=false → shu partner so'rovlari 403.
  - TC4: Har amal activity-log'ga yoziladi.

#### C1.4 — Elchi: geo passthrough
- **Assignee:** L · **Labels:** Phase 1, Elchi-Integration, 🟡 Normal · **Hajm:** S (1 kun) · **Deadline:** 2026-08-07 · **Bog'liqlik:** C1.2
- **Acceptance:** [ ] regions/districts/tariff · [ ] logistics.* ichkarida
- **🧪 Testlar:**
  - TC1: `GET /partner/regions` → real Elchi regionlari (bo'sh emas).
  - TC2: `GET /partner/districts?region_id=X` → shu region tumanlari.
  - TC3: `GET /partner/tariff?...` → tarif summasi qaytadi.

#### C1.5 — Elchi: POST /partner/markets (provisioning)
- **Assignee:** L · **Labels:** Phase 1, Elchi-Integration, 🔴 Blocker · **Hajm:** L (3 kun) · **Deadline:** 2026-08-12 · **Bog'liqlik:** C1.2
- **Acceptance:** [ ] {external_seller_id}→{elchi_market_id} · [ ] market.create+cashbox · [ ] idempotent · [ ] partner↔market
- **🧪 Testlar:**
  - TC1: Yangi `external_seller_id` → Elchi'da market(role=market) + cashbox yaratiladi; `elchi_market_id` qaytadi.
  - TC2: **Idempotent:** bir xil `external_seller_id` 2-marta → **yangi market yaratilmaydi**, o'sha id qaytadi.
  - TC3: Yaratilgan market shu partner bilan bog'langan (boshqa partner ko'ra olmaydi).

#### C1.6 — Marketplace: elchi-integration client
- **Assignee:** L · **Labels:** Phase 1, Elchi-Integration, 🟠 High · **Hajm:** M (2 kun) · **Deadline:** 2026-08-14 · **Bog'liqlik:** C1.5
- **Acceptance:** [ ] approve→/partner/markets→shop.elchi_market_id · [ ] geo_cache sync · [ ] AES key, retry
- **🧪 Testlar:**
  - TC1: Shop approve → integration Elchi'ga so'rov yuboradi → `shop.elchi_market_id` to'ldiriladi.
  - TC2: Elchi vaqtincha ishlamasa → retry; muvaffaqiyatda market_id keladi (ikki marta market ochilmaydi — idempotent).
  - TC3: geo_cache — region/district nomi Elchi id bilan mos.

#### C1.7 — Admin backend: shops moderatsiya
- **Assignee:** L · **Labels:** Phase 1, Backend-Core, 🟠 High · **Hajm:** M (2 kun) · **Deadline:** 2026-08-18 · **Bog'liqlik:** C1.6, C0.6
- **Acceptance:** [ ] GET /admin/shops · [ ] approve(active+warehouse+provision) · [ ] reject · [ ] notify
- **🧪 Testlar:**
  - TC1: `GET /admin/shops?status=pending` → faqat pending do'konlar.
  - TC2: approve → shop.active, user.active, default warehouse yaratiladi, `elchi_market_id` bor.
  - TC3: reject → shop.rejected; sotuvchiga notifikatsiya.
  - TC4: Oddiy seller admin route'ga kirsa → 403.

### 🟢 D (Dilshodbek) — Sotuvchi kabineti API'lari

#### C1.8 — Seller register endpoint
- **Assignee:** D · **Labels:** Phase 1, Backend-Commerce, 🔴 Blocker · **Hajm:** M (2 kun) · **Deadline:** 2026-08-05 · **Bog'liqlik:** C0.4, C0.6
- **Acceptance:** [ ] user(seller,inactive)+shop(pending) atomik · [ ] admin notify · [ ] dublikat tekshiruv
- **🧪 Testlar:**
  - TC1: `POST /sellers/register` → user(role=seller, inactive) + shop(pending) **ikkalasi** yaratiladi.
  - TC2: shop yaratishda xato bo'lsa → user ham yaratilmaydi (tranzaksion rollback).
  - TC3: Mavjud phone/shop_name → 409.
  - TC4: Admin'ga "yangi sotuvchi" notifikatsiyasi boradi.

#### C1.9 — Shop profil /sellers/me
- **Assignee:** D · **Labels:** Phase 1, Backend-Commerce, 🟡 Normal · **Hajm:** S (1 kun) · **Deadline:** 2026-08-06 · **Bog'liqlik:** C1.8
- **Acceptance:** [ ] GET/PATCH /sellers/me · [ ] SelfGuard
- **🧪 Testlar:**
  - TC1: seller `GET /sellers/me` → o'z do'koni ma'lumoti.
  - TC2: `PATCH` bilan nom/telefon o'zgaradi va saqlanadi.
  - TC3: Boshqa seller'ning do'konini o'zgartirish urinishi → 403.

#### C1.10 — Category CRUD + public tree
- **Assignee:** D · **Labels:** Phase 1, Backend-Commerce, 🟡 Normal · **Hajm:** S (1 kun) · **Deadline:** 2026-08-07 · **Bog'liqlik:** C0.6
- **Acceptance:** [ ] admin CRUD · [ ] public tree · [ ] slug uniq
- **🧪 Testlar:**
  - TC1: Admin kategoriya yaratadi (parent bilan) → daraxtda ko'rinadi.
  - TC2: `GET /categories` → ierarxik daraxt (parent→children).
  - TC3: Dublikat slug → xato. Oddiy user create → 403.

#### C1.11 — Product CRUD (boy)
- **Assignee:** D · **Labels:** Phase 1, Backend-Commerce, 🔴 Blocker · **Hajm:** L (3 kun) · **Deadline:** 2026-08-12 · **Bog'liqlik:** C0.6, C1.8
- **Acceptance:** [ ] CRUD(slug/description/price/attributes/status) · [ ] /products/my filter · [ ] /products/:id · [ ] ownership
- **🧪 Testlar:**
  - TC1: Product create → slug avtomat generatsiya, DB'da barcha maydonlar to'g'ri.
  - TC2: `GET /products/my` → faqat shu seller mahsulotlari; filter/search/pagination ishlaydi.
  - TC3: Boshqa seller mahsulotini PATCH/DELETE → 403.
  - TC4: Manfiy narx / bo'sh nom → validatsiya xatosi 400.

#### C1.12 — Product variant CRUD
- **Assignee:** D · **Labels:** Phase 1, Backend-Commerce, 🟠 High · **Hajm:** M (2 kun) · **Deadline:** 2026-08-14 · **Bog'liqlik:** C1.11
- **Acceptance:** [ ] variants(sku/attributes/price/barcode) · [ ] default variant avtomat · [ ] sku uniq
- **🧪 Testlar:**
  - TC1: Variantsiz mahsulot yaratilganda → 1 ta "default" variant avtomat paydo bo'ladi.
  - TC2: Variant qo'shish (Qizil/M, sku) → saqlanadi; narx null bo'lsa product narxi olinadi.
  - TC3: Dublikat sku → xato.

#### C1.13 — file-service (MinIO) + media upload
- **Assignee:** D · **Labels:** Phase 1, Backend-Commerce, 🟠 High · **Hajm:** M (2 kun) · **Deadline:** 2026-08-18 · **Bog'liqlik:** C0.1
- **Acceptance:** [ ] MinIO bucket+URL · [ ] /files/upload(validatsiya) · [ ] images jsonb, cover
- **🧪 Testlar:**
  - TC1: Rasm upload → MinIO'ga saqlanadi, qaytgan URL brauzerda ochiladi.
  - TC2: 10MB'dan katta yoki .exe → rad etiladi (400).
  - TC3: Mahsulotga 3 rasm → `images` jsonb'da 3 ta URL; cover belgilash ishlaydi.

#### C1.14 — Warehouse + stock GET
- **Assignee:** D · **Labels:** Phase 1, Backend-Commerce, 🟠 High · **Hajm:** M (2 kun) · **Deadline:** 2026-08-20 · **Bog'liqlik:** C0.8
- **Acceptance:** [ ] warehouses CRUD · [ ] GET stock · [ ] /stock/low
- **🧪 Testlar:**
  - TC1: seller ombor yaratadi; birinchisi `is_default`.
  - TC2: `GET /inventory/stock` → variant×ombor qoldiqlari (faqat o'z do'koni).
  - TC3: `GET /inventory/stock/low` → `on_hand ≤ low_stock_threshold` bo'lganlar.

#### C1.15 — Inbound/adjust endpointlari
- **Assignee:** D · **Labels:** Phase 1, Backend-Commerce, 🟡 Normal · **Hajm:** S (1 kun) · **Deadline:** 2026-08-21 · **Bog'liqlik:** C1.14, C0.8
- **Acceptance:** [ ] inbound + adjust(sabab) · [ ] movement
- **🧪 Testlar:**
  - TC1: inbound 50 → on_hand +50; `movement(inbound)` yozildi.
  - TC2: adjust −5 (sabab) → on_hand −5; movement(adjust) sabab+actor bilan.
  - TC3: Boshqa seller omboriga inbound → 403.

#### C1.16 — Seller orders + dashboard
- **Assignee:** D · **Labels:** Phase 1, Backend-Commerce, 🟡 Normal · **Hajm:** M (2 kun) · **Deadline:** 2026-08-25 · **Bog'liqlik:** C1.6
- **Acceptance:** [ ] /seller/orders(Elchi status) · [ ] /seller/dashboard(aggregate)
- **🧪 Testlar:**
  - TC1: `GET /seller/orders` → faqat shu seller sub-buyurtmalari.
  - TC2: `GET /seller/dashboard` → sotuv soni/daromad to'g'ri hisoblangan (test ma'lumotga mos).
  - TC3: Buyurtma yo'q seller → bo'sh ro'yxat, 0 daromad (xato emas).

#### C1.17 — notification-service
- **Assignee:** D · **Labels:** Phase 1, Backend-Commerce, 🟡 Normal · **Hajm:** M (2 kun) · **Deadline:** 2026-08-27 · **Bog'liqlik:** C0.2
- **Acceptance:** [ ] notification entity + in-app · [ ] email/telegram/sms adapter · [ ] eventlar
- **🧪 Testlar:**
  - TC1: register/approve/order event → tegishli userга notification yoziladi (in-app ko'rinadi).
  - TC2: Adapter (email/telegram) chaqiriladi (mock/log bilan tasdiq).
  - TC3: Adapter xato bersa → notification o'chib qolmaydi (retry/queue).

### 🟣 B (Bahodir) — Sotuvchi kabineti ekranlari

#### C1.18 — Shop profil sahifasi
- **Assignee:** B · **Labels:** Phase 1, Frontend, 🟡 Normal · **Hajm:** M (2 kun) · **Deadline:** 2026-08-05 · **Bog'liqlik:** C0.15, C1.9
- **Acceptance:** [ ] ko'rish/tahrir · [ ] logo/banner upload · [ ] save
- **🧪 Testlar:**
  - TC1: Sahifa ochilganda joriy shop ma'lumoti to'ldirilgan.
  - TC2: Nom o'zgartirib saqlash → success, qayta ochilганda o'zgargan.
  - TC3: Logo upload → preview + saqlanadi.

#### C1.19 — Products list sahifasi
- **Assignee:** B · **Labels:** Phase 1, Frontend, 🟠 High · **Hajm:** M (2 kun) · **Deadline:** 2026-08-07 · **Bog'liqlik:** C0.14
- **Acceptance:** [ ] jadval(search/filter/status/pagination) · [ ] tez amallar · [ ] cache
- **🧪 Testlar:**
  - TC1: Ro'yxat backend'dan yuklanadi; pagination sahifalari ishlaydi.
  - TC2: Search "telefon" → filtrlangan natija.
  - TC3: Delete → tasdiqdan keyin ro'yxatdan yo'qoladi.

#### C1.20 — Product create/edit forma
- **Assignee:** B · **Labels:** Phase 1, Frontend, 🔴 Blocker · **Hajm:** L (3 kun) · **Deadline:** 2026-08-12 · **Bog'liqlik:** C1.19, C1.11
- **Acceptance:** [ ] boy forma · [ ] rasm upload · [ ] create/update
- **🧪 Testlar:**
  - TC1: Yangi mahsulot to'ldirib saqlash → ro'yxatda paydo bo'ladi.
  - TC2: Mavjudni edit → o'zgarishlar saqlanadi.
  - TC3: Majburiy maydon bo'sh → validatsiya xatosi, submit bloklanadi.
  - TC4: Kategoriya select daraxtdan tanlanadi.

#### C1.21 — Variant management UI
- **Assignee:** B · **Labels:** Phase 1, Frontend, 🟠 High · **Hajm:** M (2 kun) · **Deadline:** 2026-08-14 · **Bog'liqlik:** C1.20, C1.12
- **Acceptance:** [ ] variant qo'shish/tahrir · [ ] variantsiz holat · [ ] jadval
- **🧪 Testlar:**
  - TC1: Variant qo'shish (rang/o'lcham, sku, narx) → jadvalga qo'shiladi va saqlanadi.
  - TC2: Variant o'chirish → jadvaldan yo'qoladi.
  - TC3: Variantsiz mahsulotda default variant ko'rinadi (yashirin bo'lishi ham mumkin).

#### C1.22 — Media upload UI
- **Assignee:** B · **Labels:** Phase 1, Frontend, 🟡 Normal · **Hajm:** M (2 kun) · **Deadline:** 2026-08-18 · **Bog'liqlik:** C1.20, C1.13
- **Acceptance:** [ ] ko'p rasm drag-drop · [ ] tartib/cover · [ ] progress/xatolik
- **🧪 Testlar:**
  - TC1: Bir nechta rasm tanlab yuklash → hammasi preview'da.
  - TC2: Drag bilan tartibni o'zgartirish → saqlanadi.
  - TC3: Cover tanlash → birinchi/asosiy rasm sifatida belgilanadi.

#### C1.23 — Warehouses sahifasi
- **Assignee:** B · **Labels:** Phase 1, Frontend, 🟡 Normal · **Hajm:** S (1 kun) · **Deadline:** 2026-08-19 · **Bog'liqlik:** C1.14
- **Acceptance:** [ ] list/create · [ ] default
- **🧪 Testlar:**
  - TC1: Ombor yaratish → ro'yxatda ko'rinadi.
  - TC2: Default belgilash → bitta ombor default bo'ladi (boshqasi olib tashlanadi).

#### C1.24 — Stock (qoldiq) sahifasi
- **Assignee:** B · **Labels:** Phase 1, Frontend, 🟠 High · **Hajm:** M (2 kun) · **Deadline:** 2026-08-21 · **Bog'liqlik:** C1.23, C1.15
- **Acceptance:** [ ] qoldiq jadval · [ ] inbound modal · [ ] adjust modal · [ ] low-stock highlight
- **🧪 Testlar:**
  - TC1: Qoldiq jadvali variant×ombor bo'yicha to'g'ri sonlar.
  - TC2: Inbound modal orqali +10 → jadvalda qoldiq yangilanadi.
  - TC3: low_stock ostidagi qatorlar qizil/ajratilgan ko'rinadi.

#### C1.25 — Orders sahifasi
- **Assignee:** B · **Labels:** Phase 1, Frontend, 🟡 Normal · **Hajm:** M (2 kun) · **Deadline:** 2026-08-25 · **Bog'liqlik:** C1.16
- **Acceptance:** [ ] list + Elchi status timeline · [ ] filter
- **🧪 Testlar:**
  - TC1: Buyurtmalar ro'yxati yuklanadi; status ranglari to'g'ri.
  - TC2: Filter (status/sana) → natija filtrlanadi.
  - TC3: Buyurtma ochilganda status timeline ko'rinadi.

#### C1.26 — Dashboard sahifasi
- **Assignee:** B · **Labels:** Phase 1, Frontend, 🟡 Normal · **Hajm:** M (2 kun) · **Deadline:** 2026-08-27 · **Bog'liqlik:** C1.16
- **Acceptance:** [ ] kartalar · [ ] chart · [ ] top mahsulot
- **🧪 Testlar:**
  - TC1: Sotuv/daromad kartalari backend raqamlariga mos.
  - TC2: Grafik ma'lumot bilan render bo'ladi (bo'sh holatda ham buzilmaydi).

#### C1.27 — Admin: shops moderatsiya UI
- **Assignee:** B · **Labels:** Phase 1, Frontend, 🟠 High · **Hajm:** M (2 kun) · **Deadline:** 2026-08-31 · **Bog'liqlik:** C1.7
- **Acceptance:** [ ] pending list · [ ] detail+approve/reject · [ ] status
- **🧪 Testlar:**
  - TC1: Pending do'konlar ro'yxati ko'rinadi.
  - TC2: Approve tugmasi → do'kon active, ro'yxatdan chiqadi.
  - TC3: Reject → sabab bilan; status yangilanadi.

---

## FAZA 2 — Storefront + Checkout  ·  2026-08-31 → 09-22

### 🔵 L — Shipment ko'prigi + webhook

#### C2.1 — Elchi: POST /partner/shipments → order.create
- **Assignee:** L · **Labels:** Phase 2, Elchi-Integration, 🔴 Blocker · **Hajm:** L (3 kun) · **Deadline:** 2026-08-21 · **Bog'liqlik:** C1.5
- **Acceptance:** [ ] shipment→order.create · [ ] cod_amount=0 prepaid · [ ] idempotent · [ ] {shipment_id,...}
- **🧪 Testlar:**
  - TC1: shipment yuborilsa → Elchi'da `order` yaratiladi; `partner_shipment_ref` yoziladi; `shipment_id` qaytadi.
  - TC2: `cod_amount=0` → order `to_be_paid=0` (prepaid; kuryer pul yig'maydi).
  - TC3: `cod_amount=50000` → `to_be_paid=50000`.
  - TC4: **Idempotent:** bir xil `external_order_id` 2-marta → **yangi order yaratilmaydi**, o'sha shipment_id.

#### C2.2 — Elchi: get/cancel shipment
- **Assignee:** L · **Labels:** Phase 2, Elchi-Integration, 🟡 Normal · **Hajm:** S (1 kun) · **Deadline:** 2026-08-24 · **Bog'liqlik:** C2.1
- **Acceptance:** [ ] GET /:id · [ ] POST /cancel
- **🧪 Testlar:**
  - TC1: `GET /partner/shipments/:id` → status, tracking, cod_collected.
  - TC2: cancel → order bekor; keyingi GET status=cancelled.
  - TC3: Allaqachon yetkazilgan shipment cancel → rad (409).

#### C2.3 — Elchi: outbound webhook
- **Assignee:** L · **Labels:** Phase 2, Elchi-Integration, 🔴 Blocker · **Hajm:** L (3 kun) · **Deadline:** 2026-08-27 · **Bog'liqlik:** C2.1
- **Acceptance:** [ ] status event→outbox · [ ] HMAC POST · [ ] backoff retry · [ ] settled/remittance
- **🧪 Testlar:**
  - TC1: Order status o'zgarsa → hamkor `webhook_url`iga POST boradi; `X-Elchi-Signature` to'g'ri HMAC.
  - TC2: Hamkor 500 qaytarsa → exponential backoff bilan retry (outbox'da qoladi).
  - TC3: Hamkor 2xx → event "delivered" belgilanadi, qayta yuborilmaydi (dedup).
  - TC4: sold → `cod_collected` summasi body'da bor.

#### C2.4 — Marketplace webhook receiver
- **Assignee:** L · **Labels:** Phase 2, Elchi-Integration, 🔴 Blocker · **Hajm:** M (2 kun) · **Deadline:** 2026-08-31 · **Bog'liqlik:** C2.3, C0.8
- **Acceptance:** [ ] HMAC verify · [ ] sales_order_seller mirror · [ ] returned→inbound · [ ] delivered+online→payout
- **🧪 Testlar:**
  - TC1: To'g'ri imzoli webhook → `sales_order_seller` status yangilanadi.
  - TC2: Noto'g'ri imzo → 401, holat o'zgarmaydi.
  - TC3: `returned` event → `inventory.inbound` chaqiriladi (qoldiq tiklanadi).
  - TC4: Bir xil event 2-marta kelsa → 1 marta qayta ishlanadi (idempotent).

#### C2.5 — Elchi: OrderItem.product_id yumshatish
- **Assignee:** L · **Labels:** Phase 2, Elchi-Integration, 🟡 Normal · **Hajm:** S (1 kun) · **Deadline:** 2026-09-01 · **Bog'liqlik:** C2.1
- **Acceptance:** [ ] external item nom/qty · [ ] internal buzilmaydi
- **🧪 Testlar:**
  - TC1: External shipment item faqat nom+qty bilan → order yaratiladi (product_id null bo'lsa ham).
  - TC2: Mavjud internal order oqimi (product_id bilan) hamon ishlaydi (regressiya testi yashil).

> ℹ️ L C2.5'ni ~sen 1'da tugatadi — core ishi tugaydi. Keyin review + backend overflow (C2.7/C3.x).

### 🟢 D (Dilshodbek) — Cart + checkout

#### C2.6 — Catalog public endpoints
- **Assignee:** D · **Labels:** Phase 2, Backend-Commerce, 🟠 High · **Hajm:** M (2 kun) · **Deadline:** 2026-08-31 · **Bog'liqlik:** C1.11
- **Acceptance:** [ ] list(filter/sort/pagination) · [ ] product detail · [ ] shop page(active)
- **🧪 Testlar:**
  - TC1: `GET /storefront/products` → faqat `active` mahsulotlar (draft/archived ko'rinmaydi).
  - TC2: Filter (kategoriya/narx) va sort ishlaydi.
  - TC3: Suspended shop mahsulotlari public'da ko'rinmaydi.

#### C2.7 — search-service
- **Assignee:** D (yoki L) · **Labels:** Phase 2, Backend-Commerce, 🟠 High · **Hajm:** L (3 kun) · **Deadline:** 2026-09-03 · **Bog'liqlik:** C2.6
- **Acceptance:** [ ] index · [ ] search+facet · [ ] reindex on event
- **🧪 Testlar:**
  - TC1: "telefon" qidiruvi → mos mahsulotlar (relevantlik bo'yicha).
  - TC2: Facet filter (narx oralig'i, kategoriya) → to'g'ri toraytiradi.
  - TC3: Yangi mahsulot qo'shilsa → indeksga tushadi (reindex event).

#### C2.8 — cart-service
- **Assignee:** D · **Labels:** Phase 2, Backend-Commerce, 🟠 High · **Hajm:** M (2 kun) · **Deadline:** 2026-09-07 · **Bog'liqlik:** C0.6
- **Acceptance:** [ ] cart+item(add/update/remove) · [ ] narx snapshot · [ ] anon+logged
- **🧪 Testlar:**
  - TC1: Savatga qo'shish → item paydo; narx snapshot saqlanadi.
  - TC2: Qty o'zgartirish/o'chirish → savat yangilanadi.
  - TC3: Anon (session_id) savat login'dan keyin userga bog'lanadi (merge).

#### C2.9 — checkout.create (split)
- **Assignee:** D · **Labels:** Phase 2, Backend-Commerce, 🔴 Blocker · **Hajm:** L (3 kun) · **Deadline:** 2026-09-10 · **Bog'liqlik:** C2.8, C0.8
- **Acceptance:** [ ] shop_id guruh→N sub-order · [ ] sales_order+item · [ ] reserve ttl=30daq · [ ] manzil
- **🧪 Testlar:**
  - TC1: 2 do'kondan savat → checkout → **2 ta** `sales_order_seller` yaratiladi.
  - TC2: checkout → `inventory.reserve` chaqiriladi; qoldiq band bo'ladi (reserved oshadi).
  - TC3: Qoldiq yetmasa → checkout **rad etiladi** (400), sales_order yaratilmaydi.
  - TC4: online → sales_order `pending_payment`; COD → `draft`.

#### C2.10 — confirmSalesOrder (COD path)
- **Assignee:** D · **Labels:** Phase 2, Backend-Commerce, 🔴 Blocker · **Hajm:** L (3 kun) · **Deadline:** 2026-09-15 · **Bog'liqlik:** C2.9, C2.1
- **Acceptance:** [ ] har seller→/partner/shipments(cod=subtotal) · [ ] inventory.commit · [ ] confirmed+notify
- **🧪 Testlar:**
  - TC1: COD confirm → har sub-order uchun Elchi shipment yaratiladi (cod_amount=subtotal).
  - TC2: confirm → `inventory.commit` (reserved→on_hand kamayadi); sales_order=confirmed.
  - TC3: `elchi_shipment_id` har sub-order'ga saqlanadi; seller+buyer notifikatsiya.
  - TC4: Bir shipment yaratishda xato → butun confirm rollback (reserved qolaveradi, keyin retry).

#### C2.11 — Sales order status mirror + returns
- **Assignee:** D · **Labels:** Phase 2, Backend-Commerce, 🟠 High · **Hajm:** M (2 kun) · **Deadline:** 2026-09-17 · **Bog'liqlik:** C2.4
- **Acceptance:** [ ] webhook→status · [ ] returned→inbound · [ ] seller orders real
- **🧪 Testlar:**
  - TC1: Elchi "on the road" webhook → sub-order status shunga o'zgaradi.
  - TC2: "returned" → qoldiq inbound bilan tiklanadi; sub-order=returned.
  - TC3: seller orders sahifasida real status ko'rinadi (C1.16 bilan mos).

### 🟣 B (Bahodir) — Storefront (Next.js)

#### C2.12 — storefront Next.js setup
- **Assignee:** B · **Labels:** Phase 2, Frontend, 🟠 High · **Hajm:** M (2 kun) · **Deadline:** 2026-09-02 · **Bog'liqlik:** C0.0b
- **Acceptance:** [ ] SSR · [ ] layout/SEO/sitemap · [ ] API client
- **🧪 Testlar:**
  - TC1: `npm run build && start` → SSR sahifa server'da render bo'ladi (view-source'da HTML bor).
  - TC2: `<title>`/meta teglari sahifada mavjud.
  - TC3: `/sitemap.xml` ochiladi.

#### C2.13 — Home + catalog listing
- **Assignee:** B · **Labels:** Phase 2, Frontend, 🔴 Blocker · **Hajm:** L (3 kun) · **Deadline:** 2026-09-07 · **Bog'liqlik:** C2.12, C2.6
- **Acceptance:** [ ] bosh+kategoriya · [ ] listing(filter/sort/pagination SSR) · [ ] qidiruv
- **🧪 Testlar:**
  - TC1: Bosh sahifa mahsulotlar + kategoriyalar bilan yuklanadi.
  - TC2: Filter/sort URL query'ga yoziladi va SSR'da qo'llanadi.
  - TC3: Qidiruv maydoni → natijalar sahifasi.

#### C2.14 — Product detail sahifasi
- **Assignee:** B · **Labels:** Phase 2, Frontend, 🟠 High · **Hajm:** M (2 kun) · **Deadline:** 2026-09-09 · **Bog'liqlik:** C2.13
- **Acceptance:** [ ] galereya · [ ] variant tanlash · [ ] savatga · [ ] SEO
- **🧪 Testlar:**
  - TC1: Mahsulot sahifasi rasm galereyasi bilan ochiladi.
  - TC2: Variant tanlanganda narx/rasm yangilanadi.
  - TC3: "Savatga qo'shish" → savat soni oshadi.
  - TC4: OG/schema.org meta teglari mavjud.

#### C2.15 — Shop storefront sahifasi
- **Assignee:** B · **Labels:** Phase 2, Frontend, 🟡 Normal · **Hajm:** M (2 kun) · **Deadline:** 2026-09-11 · **Bog'liqlik:** C2.13
- **Acceptance:** [ ] shop header · [ ] mahsulotlar · [ ] slug route
- **🧪 Testlar:**
  - TC1: `/shop/[slug]` → do'kon sahifasi (logo, rating, mahsulotlar).
  - TC2: Noto'g'ri slug → 404.

#### C2.16 — Cart sahifasi
- **Assignee:** B · **Labels:** Phase 2, Frontend, 🟠 High · **Hajm:** M (2 kun) · **Deadline:** 2026-09-15 · **Bog'liqlik:** C2.8
- **Acceptance:** [ ] ko'p sotuvchi guruh · [ ] qty/o'chirish · [ ] jami
- **🧪 Testlar:**
  - TC1: 2 do'kon mahsuloti → savat **do'kon bo'yicha guruhlangan**.
  - TC2: Qty o'zgartirish → jami avtomat qayta hisoblanadi.
  - TC3: Item o'chirish → savatdan chiqadi.

#### C2.17 — Checkout sahifasi
- **Assignee:** B · **Labels:** Phase 2, Frontend, 🔴 Blocker · **Hajm:** L (3 kun) · **Deadline:** 2026-09-18 · **Bog'liqlik:** C2.16, C2.9
- **Acceptance:** [ ] manzil/region/district · [ ] to'lov usuli · [ ] per-seller posilka preview · [ ] buyurtma
- **🧪 Testlar:**
  - TC1: Manzil + region/district tanlanadi; to'ldirilmasa submit bloklanadi.
  - TC2: 2 do'kon → **2 alohida posilka** ko'rsatiladi (preview).
  - TC3: To'lov usuli (COD/online) tanlanadi.
  - TC4: "Buyurtma berish" → backend checkout, tasdiq sahifasiga o'tadi.

#### C2.18 — Order confirmation + tracking
- **Assignee:** B · **Labels:** Phase 2, Frontend, 🟡 Normal · **Hajm:** M (2 kun) · **Deadline:** 2026-09-22 · **Bog'liqlik:** C2.17
- **Acceptance:** [ ] tasdiq · [ ] posilka status/tracking
- **🧪 Testlar:**
  - TC1: Buyurtmadan keyin tasdiq sahifasi (buyurtma raqami, posilkalar).
  - TC2: Har posilka status/tracking ko'rsatiladi.

---

## FAZA 3 — Online to'lov  ·  2026-09-16 → 09-29

#### C3.1 — payment-service skeleton
- **Assignee:** D · **Labels:** Phase 3, Backend-Commerce, 🟠 High · **Hajm:** M (2 kun) · **Deadline:** 2026-09-21 · **Bog'liqlik:** C2.9
- **Acceptance:** [ ] payment/txn/provider_config(AES) · [ ] payment.create · [ ] SSRF-guard
- **🧪 Testlar:**
  - TC1: `payment.create` → payment(created) yoziladi.
  - TC2: provider_config secret AES (DB'da ochiq emas).
  - TC3: Ichki IP'ga tashqi so'rov → SSRF-guard bloklaydi.

#### C3.2 — Payme JSON-RPC callback
- **Assignee:** D · **Labels:** Phase 3, Backend-Commerce, 🔴 Blocker · **Hajm:** L (3 kun) · **Deadline:** 2026-09-24 · **Bog'liqlik:** C3.1
- **Acceptance:** [ ] 6 metod · [ ] Basic auth · [ ] state→txn · [ ] sandbox
- **🧪 Testlar:**
  - TC1: **Payme sandbox** to'liq ssenariysi (CheckPerform→Create→Perform) → to'lov `paid`.
  - TC2: CheckPerformTransaction noto'g'ri summa → to'g'ri error kodi (-31001).
  - TC3: Noto'g'ri Basic auth → rad.
  - TC4: CancelTransaction → payment cancelled, state to'g'ri.
  - TC5: Bir xil transaction 2-marta Perform → idempotent (bir marta).

#### C3.3 — Click Prepare/Complete
- **Assignee:** L · **Labels:** Phase 3, Backend-Commerce, 🟠 High · **Hajm:** M (2 kun) · **Deadline:** 2026-09-23 · **Bog'liqlik:** C3.1
- **Acceptance:** [ ] prepare+complete · [ ] sign_string(md5) · [ ] sandbox
- **🧪 Testlar:**
  - TC1: **Click sandbox** Prepare→Complete → to'lov `paid`.
  - TC2: Noto'g'ri `sign_string` → rad (-1 error).
  - TC3: Complete summasi mos kelmasa → rad.

#### C3.4 — payment.paid → confirmSalesOrder (online)
- **Assignee:** L · **Labels:** Phase 3, Backend-Commerce, 🔴 Blocker · **Hajm:** S (1 kun) · **Deadline:** 2026-09-25 · **Bog'liqlik:** C3.2, C2.10
- **Acceptance:** [ ] paid→confirm · [ ] cod_amount=0 shipment · [ ] inventory.commit
- **🧪 Testlar:**
  - TC1: `payment.paid` event → sales_order confirmed; har seller shipment **cod_amount=0** (prepaid).
  - TC2: To'lov muvaffaqiyatsiz → confirm bo'lmaydi; reservation TTL bilan bo'shaydi.
  - TC3: confirm → inventory.commit (qoldiq kamayadi).

#### C3.5 — finance-service (escrow → payout)
- **Assignee:** D · **Labels:** Phase 3, Backend-Commerce, 🔴 Blocker · **Hajm:** L (3 kun) · **Deadline:** 2026-09-29 · **Bog'liqlik:** C3.4
- **Acceptance:** [ ] ledger/payout/commission · [ ] delivered→ledger→payout · [ ] percent/fixed
- **🧪 Testlar:**
  - TC1: online delivered → `seller_ledger`: sale (+), commission (−) yozuvlari; balance to'g'ri.
  - TC2: Komissiya percent (masalan 10%) → to'g'ri hisoblanadi; fixed ham.
  - TC3: payout so'rov → ledger balansiga mos summa; ikki marta payout **imkonsiz** (idempotent).
  - TC4: refund → ledger'da teskari yozuv.

#### C3.6 — Refund flow
- **Assignee:** L · **Labels:** Phase 3, Backend-Commerce, 🟠 High · **Hajm:** M (2 kun) · **Deadline:** 2026-09-29 · **Bog'liqlik:** C3.2, C2.4
- **Acceptance:** [ ] Cancel/returned→refund · [ ] inventory.inbound · [ ] ledger refund
- **🧪 Testlar:**
  - TC1: online returned → Payme CancelTransaction chaqiriladi; payment refunded.
  - TC2: refund → qoldiq inbound bilan tiklanadi.
  - TC3: ledger'da refund yozuvi; seller balansi kamayadi.

#### C3.7 — Checkout payment integration (FE)
- **Assignee:** B · **Labels:** Phase 3, Frontend, 🟠 High · **Hajm:** M (2 kun) · **Deadline:** 2026-09-24 · **Bog'liqlik:** C2.17, C3.1
- **Acceptance:** [ ] Payme/Click redirect · [ ] return callback · [ ] holat
- **🧪 Testlar:**
  - TC1: Online tanlab "to'lash" → Payme/Click sahifasiga redirect.
  - TC2: To'lovdan qaytish → holat sahifasiga o'tadi.

#### C3.8 — Payment status sahifasi (FE)
- **Assignee:** B · **Labels:** Phase 3, Frontend, 🟡 Normal · **Hajm:** S (1 kun) · **Deadline:** 2026-09-25 · **Bog'liqlik:** C3.7
- **Acceptance:** [ ] success/fail/pending · [ ] buyurtmaga qaytish
- **🧪 Testlar:**
  - TC1: To'lov muvaffaqiyatli → success sahifasi + buyurtma havolasi.
  - TC2: Bekor/xato → fail sahifasi + qayta urinish.

#### C3.9 — Seller finance sahifasi (FE)
- **Assignee:** B · **Labels:** Phase 3, Frontend, 🟡 Normal · **Hajm:** M (2 kun) · **Deadline:** 2026-09-29 · **Bog'liqlik:** C3.5
- **Acceptance:** [ ] ledger/balans · [ ] payout tarixi · [ ] komissiya
- **🧪 Testlar:**
  - TC1: Ledger yozuvlari va joriy balans ko'rinadi (backend bilan mos).
  - TC2: Payout tarixi ro'yxati; komissiya ustunlari to'g'ri.

---

## FAZA 4 — Sayqal + deploy  ·  2026-09-30 → 10-12

#### C4.1 — Review / rating
- **Assignee:** D · **Labels:** Phase 4, Backend-Commerce, 🟡 Normal · **Hajm:** M (2 kun) · **Deadline:** 2026-10-01 · **Bog'liqlik:** C2.11
- **Acceptance:** [ ] review entity(delivered) · [ ] rating aggregate · [ ] FE
- **🧪 Testlar:**
  - TC1: Faqat `delivered` buyurtma egasi sharh qoldira oladi; boshqa → rad.
  - TC2: Sharh qo'shilgach shop/product `rating` qayta hisoblanadi (o'rtacha).
  - TC3: Bir buyurtmaga ikki marta sharh → rad.

#### C4.2 — Returns / refund UI
- **Assignee:** B · **Labels:** Phase 4, Frontend, 🟡 Normal · **Hajm:** M (2 kun) · **Deadline:** 2026-10-01 · **Bog'liqlik:** C3.6
- **Acceptance:** [ ] buyer so'rov · [ ] seller/admin ko'rish · [ ] status oqimi
- **🧪 Testlar:**
  - TC1: Buyer qaytarish so'rovi yuboradi → seller/admin ko'radi.
  - TC2: So'rov tasdiqlansa → refund oqimi ishga tushadi (C3.6).

#### C4.3 — COD komissiya reconciliation
- **Assignee:** D + L · **Labels:** Phase 4, Backend-Commerce, 🟠 High · **Hajm:** L (3 kun) · **Deadline:** 2026-10-06 · **Bog'liqlik:** C2.3, C3.5
- **Tavsif:** Ochiq savol §16.1 yechimi (tavsiya: **netting**).
- **Acceptance:** [ ] settled→ledger · [ ] netting/invoys · [ ] recon hisobot
- **🧪 Testlar:**
  - TC1: Elchi `shipment.settled` → COD sotuv `seller_ledger`ga yoziladi (komissiya (−) bilan).
  - TC2: Netting: sotuvchining online payout'idan COD komissiya ushlanadi; balans to'g'ri.
  - TC3: Recon hisobot: COD yig'ilgan summa vs kutilgan komissiya farqi = 0 (test ma'lumotda).

#### C4.4 — Analytics dashboard (admin)
- **Assignee:** B · **Labels:** Phase 4, Frontend, 🟡 Normal · **Hajm:** M (2 kun) · **Deadline:** 2026-10-05 · **Bog'liqlik:** C1.16
- **Acceptance:** [ ] GMV/orders/top · [ ] grafiklar
- **🧪 Testlar:**
  - TC1: GMV/buyurtma soni backend hisobiga mos.
  - TC2: Top shops/mahsulot ro'yxati to'g'ri tartibda.
  - TC3: Sana oralig'i filtri natijani o'zgartiradi.

#### C4.5 — Admin moderatsiya kengaytmasi
- **Assignee:** D · **Labels:** Phase 4, Backend-Commerce, 🟡 Normal · **Hajm:** M (2 kun) · **Deadline:** 2026-10-08 · **Bog'liqlik:** C1.7
- **Acceptance:** [ ] suspend/reactivate · [ ] product moderatsiya · [ ] audit log
- **🧪 Testlar:**
  - TC1: Shop suspend → uning mahsulotlari storefront'da yo'qoladi.
  - TC2: reactivate → qaytadi.
  - TC3: Har moderatsiya amali audit log'ga yoziladi.

#### C4.6 — E2E smoke + deploy + monitoring
- **Assignee:** L · **Labels:** Phase 4, DevOps, 🔴 Blocker · **Hajm:** M (2 kun) · **Deadline:** 2026-10-12 · **Bog'liqlik:** hammasi
- **Acceptance:** [ ] E2E to'liq oqim · [ ] prod deploy+domen+TLS · [ ] log/monitoring, backup
- **🧪 Testlar:**
  - TC1: **To'liq E2E:** register→approve→product→stock→checkout→Elchi shipment→webhook→delivered→payout — uzilishsiz o'tadi.
  - TC2: Prod domen HTTPS'da ochiladi (TLS yaroqli).
  - TC3: Bir servis yiqilsa → monitoring/alert ishlaydi; log ko'rinadi.
  - TC4: DB backup olinadi va tiklab ko'riladi (restore testi).

---

## 3. Xulosa

| Faza | Cards | L | D (Dilshodbek) | B (Bahodir) |
|---|---|---|---|---|
| 0 | 17 | 5 | 5 | 5 + 2 setup |
| 1 | 20 | 7 | 10 | 10 |
| 2 | 18 | 5 | 6 | 7 |
| 3 | 9 | 3 | 3 | 3 |
| 4 | 6 | 1 | 3 | 2 |
| **Jami** | **~70 card** | | | |

**Tugash (ketma-ket, Dush–Juma):** L ~10-12 (deploy), D ~10-08, B ~10-05. **Yakuniy: ~2026-10-12.**

---

## 4. Optimizatsiya (tezroq tugatish)

L core ishini ~sen 1'da tugatadi. Bo'sh vaqtni: (1) **har card testlarini review** qilish,
(2) backend overflow'ni olish (**C2.7 search**, **C4.3 recon**) — bu D'ni ~1 hafta tezlashtiradi.
Bahodir kritik yo'l (2 app). Kerak bo'lsa admin UI (C1.27, C4.4) keyinga suriladi.

> **Kritik yo'l:** C0.8 (inventory) → C1.5 (market) → C2.1 (shipment) → C2.3/C2.4 (webhook) → C2.9/C2.10 (checkout) → C3.2 (Payme).
> **Test qoidasi:** card faqat 🧪 testlaridan o'tsa `Done`. Backend testlari CI'da avtomat, frontend qo'lda QA + kerak bo'lsa Playwright.
