# Elchi Marketplace — Texnik Topshiriq (TZ)

> **Bu hujjat nima?** Loyihaning **bosh hujjati** (single entry point). Uni birinchi bo'lib
> o'qing. Yuqoridan pastga qarab murakkablashadi: boshi **oddiy til** (har kim tushunadi),
> o'rtasi **funksiyalar** (nima ishlashi kerak), oxiri **texnik detallar** (dasturchi/AI uchun).
>
> **Chuqurroq detallar** alohida fayllarda (§14 "Hujjatlar xaritasi"). Ziddiyat bo'lsa:
> model/enum manbasi — `MARKETPLACE_PLAN.md`, API shakli — `API_CONTRACT.md`.

Holat: **DRAFT** · Oxirgi yangilanish: 2026-07 · Til: O'zbekcha (lotin)

---

## Qanday o'qish kerak — bo'lim belgilari

Har bo'lim tepasida kim uchun ekani belgilangan:

| Belgi | Kim uchun | Nima kutiladi |
|---|---|---|
| 👤 | **Hamma** (biznes, mijoz, yangi a'zo) | Texnik bilim shart emas, oddiy til |
| 💻 | **Dasturchi** | Kod yozadigan odam uchun aniq texnik talab |
| 🤖 | **AI / avtomat** | Bir ma'noli, to'liq kontekst — AI kod yozsa ham adashmaydi |

> Faqat g'oyani tushunmoqchi bo'lsangiz — **§0–§4** yetarli.
> Kod yozmoqchi bo'lsangiz — **§5–§13** ni ham o'qing.

---

## Mundarija

**A qism — Hamma uchun (oddiy til)**
0. [Bir qarashda](#0-bir-qarashda-)
1. [Lug'at — atamalar oddiy tilda](#1-lugat--atamalar-oddiy-tilda-)
2. [Maqsad va asosiy qarorlar](#2-maqsad-va-asosiy-qarorlar-)
3. [Kim foydalanadi va nima qiladi (user stories)](#3-kim-foydalanadi-va-nima-qiladi-)

**B qism — Nima ishlashi kerak (funksiyalar)**
4. [Funksional talablar](#4-funksional-talablar-)

**C qism — Qanday ishlaydi (texnika)**
5. [Arxitektura](#5-arxitektura-)
6. [Servislar](#6-servislar-)
7. [Ma'lumotlar modeli](#7-malumotlar-modeli-)
8. [Muhim jarayonlar (flow)](#8-muhim-jarayonlar-flow-)
9. [API qoidalari](#9-api-qoidalari-)
10. [Non-funksional talablar (sifat)](#10-non-funksional-talablar-sifat-)

**D qism — Reja va boshqaruv**
11. [Fazalar va muddat](#11-fazalar-va-muddat-)
12. [Qabul mezoni (Definition of Done)](#12-qabul-mezoni-)
13. [Xatarlar va ochiq savollar](#13-xatarlar-va-ochiq-savollar-)
14. [Hujjatlar xaritasi](#14-hujjatlar-xaritasi-)

---

# A qism — Hamma uchun

## 0. Bir qarashda 👤

**Elchi Marketplace** — bu **ko'p sotuvchili onlayn bozor** (marketplace). Bitta saytda ko'p
do'konlar savdo qiladi, xaridorlar esa turli do'konlardan mahsulot tanlab, bitta savatga
solib, bir marta buyurtma beradi. Yetkazib berishni **Elchi pochta** bajaradi.

**Oddiy analogiya:** *Uzum Market* yoki *Yandex Market* kabi bozor + yetkazishni *Elchi* qiladi.

Uch xil odam tizimdan foydalanadi:

- 🧑‍💼 **Sotuvchi** — o'z do'konini ochadi, mahsulot joylaydi, sklad (ombordagi qoldiq)
  boshqaradi, buyurtmalarni ko'radi.
- 🛒 **Xaridor** — katalogdan mahsulot tanlaydi, savatga soladi, to'laydi, mahsulotni oladi.
- 🛡️ **Admin** — yangi do'konlarni tekshirib tasdiqlaydi (moderatsiya), tartibni saqlaydi.

**Nega bu kerak?** Bugun kichik sotuvchida na sayt, na sklad tizimi, na yetkazish logistikasi
bor. Bu platforma uchtasini bitta joyda beradi: *"ro'yxatdan o'ting — mahsulot qo'ying —
soting, qolganini biz qilamiz."*

**Bitta jumlada:** *Istalgan odam ro'yxatdan o'tib, o'z onlayn do'konini ochib, ko'p omborli
skladini boshqarib, onlayn sotadi; buyurtma avtomat Elchi'ga topshiriladi va yetkaziladi.*

---

## 1. Lug'at — atamalar oddiy tilda 👤

> Bu jadval butun hujjat davomida kerak bo'ladi. Notanish so'z uchrasa — shu yerga qarang.

| Atama | Oddiy tilda | Texnik nomi |
|---|---|---|
| **Marketplace** | Ko'p do'kon savdo qiladigan onlayn bozor | multi-vendor marketplace |
| **Sotuvchi** | Do'kon egasi, mahsulot sotuvchi | seller |
| **Xaridor** | Mahsulot sotib oluvchi | buyer / customer |
| **Do'kon** | Sotuvchining sahifasi (nomi, logotipi, mahsulotlari) | shop / storefront |
| **Katalog** | Barcha mahsulotlar ro'yxati, kategoriyalarga bo'lingan | catalog |
| **Mahsulot** | Sotuvdagi bir buyum (masalan "Adidas krossovka") | product |
| **Variant** | Bir mahsulotning turi (masalan "Qizil / 42-o'lcham") | product variant |
| **SKU** | Har variantning noyob kodi (omborda aniqlash uchun) | stock keeping unit |
| **Ombor / sklad** | Mahsulot saqlanadigan joy; qoldiq shu yerda hisoblanadi | warehouse / inventory |
| **Qoldiq** | Omborda nechta dona bor | stock / quantity on hand |
| **Rezervatsiya** | Buyurtma paytida qoldiqni "band qilish" (boshqa olib ketmasin) | reservation |
| **Oversell** | Yo'q mahsulotni sotib qo'yish xatosi (tizim buni **oldini oladi**) | oversell |
| **Savat** | Xaridor tanlagan mahsulotlar to'plami | cart |
| **Buyurtma** | To'lov/yetkazish uchun rasmiylashtirilgan savat | sales order |
| **Ko'p-sotuvchi split** | Bitta savatda 2 do'kon bo'lsa — 2 alohida posilkaga bo'linishi | multi-seller split |
| **Shipment (posilka)** | Elchi yetkazadigan bir jo'natma | shipment |
| **COD** | "Yetkazganda to'lash" (naqd, kuryerga) | cash on delivery |
| **Online to'lov** | Sayt orqali oldindan to'lash (Payme/Click) | prepaid |
| **Escrow** | Onlayn pulni vaqtincha platforma ushlab turishi, keyin sotuvchiga berishi | escrow |
| **Payout** | Platforma sotuvchiga pulini o'tkazishi | payout |
| **Komissiya** | Platforma har sotuvdan oladigan foiz/haq | commission |
| **Moderatsiya** | Admin do'konni tekshirib tasdiqlashi | approval |
| **Partner API** | Marketplace Elchi bilan gaplashadigan "ko'prik" (interfeys) | partner API |
| **Webhook** | Elchi voqea bo'lganda (masalan "yetkazildi") o'zi xabar yuborishi | webhook |
| **Mikroservis** | Katta tizimni mustaqil kichik bo'laklarga bo'lish | microservice |

---

## 2. Maqsad va asosiy qarorlar 👤

### 2.1 Maqsad (vizyon)

Kichik va o'rta sotuvchilar uchun **"savdoni boshlashning eng oson yo'li"** bo'lish:
do'kon, katalog, sklad va yetkazish — hammasi bitta platformada. Xaridor uchun esa
**ishonchli, tez yetkaziladigan** onlayn bozor.

### 2.2 Asosiy qarorlar (nima uchun shunday)

| # | Savol | Qaror | Nega |
|---|---|---|---|
| 1 | Do'konlar qanday ko'rinadi? | Umumiy katalog **+** har sotuvchining alohida do'koni (o'z sahifasi) | Xaridor bir joydan qidiradi, lekin do'kon brendi saqlanadi |
| 2 | Qanday to'lanadi? | Onlayn (Payme/Click) **+** COD (naqd, yetkazganda) | O'zbekistonda ikkalasi ham keng ishlatiladi |
| 3 | Birinchi nimani quramiz? | **Sotuvchi kabineti** (MVP) | Avval sotuvchi mahsulot qo'ysin — bozorda tovar bo'lsin |
| 4 | Sklad qanday? | Ko'p ombor **+** rezervatsiya | Sotuvchida bir necha ombor bo'lishi mumkin; oversell bo'lmasin |
| 5 | Qanday texnologiya? | Mustaqil NestJS mikroservis tizimi | Elchi'ning sinovdan o'tgan patternlari qayta ishlatiladi |
| 6 | Pul kim orqali? | **Aralash:** onlayn → platforma ushlaydi (escrow); COD → Elchi kuryeri yig'adi | Har yo'l o'z tabiatiga mos |
| 7 | Elchi bilan qanday ulanish? | Yangi **Partner API + webhook** (Elchi'da alohida) | Elchi'ning ishlab turgan dostavkasiga tegmaymiz |

### 2.3 MVP — birinchi bosqichda nima bor

**Bor:** sotuvchi ro'yxati → admin tasdiqi → do'kon → mahsulot + variant + rasm →
ko'p omborli sklad → buyurtmalarni ko'rish → Elchi'da do'kon akkaunti ochilishi.

**Keyin (Faza 2–3):** xaridor uchun ochiq sayt (storefront), savat, checkout, onlayn to'lov.

### 2.4 Nima QILINMAYDI (non-goals, MVP)

Chat (xaridor↔sotuvchi), promo-kod/kupon, sodiqlik dasturi, reklama, tavsiya tizimi,
ko'p valyuta, xalqaro yetkazish, mobil ilova (faqat web), avtomatik import (CSV/1C),
Elchi'dan boshqa yetkazish xizmatlari. *(Bular kelajakda qo'shilishi mumkin.)*

---

## 3. Kim foydalanadi va nima qiladi 👤

> **User story** — "Men [rol] sifatida, [nima]ni xohlayman, chunki [nima uchun]."
> Bu funksiyalarni oddiy tilda tushuntiradi.

### 3.1 🧑‍💼 Sotuvchi

- Men ro'yxatdan o'tib, **o'z do'konimni ochmoqchiman**, chunki onlayn savdoni boshlamoqchiman.
- Men **mahsulot va uning variantlarini** (rang, o'lcham) rasm bilan joylashtirmoqchiman.
- Men **bir necha omborimni** va har biridagi **qoldiqni** boshqarmoqchiman.
- Men **buyurtmalarim va ularning yetkazish holatini** ko'rmoqchiman.
- Men **sotuv va daromadim statistikasini** ko'rmoqchiman.

**Oddiy sahna:** Akmal ro'yxatdan o'tadi → admin tasdiqlaydi → "Adidas krossovka" mahsulotini
qo'shadi, 3 ta rasm yuklaydi, "Qizil/42", "Qora/43" variantlarini qo'shadi → omboriga 50 dona
kirim qiladi → do'koni ishga tushadi.

### 3.2 🛒 Xaridor *(Faza 2)*

- Men **katalogdan qidirib**, mahsulot tanlamoqchiman.
- Men **turli do'konlardan olib**, bitta savatga solmoqchiman.
- Men **onlayn yoki yetkazilganda naqd** to'lamoqchiman.
- Men **buyurtmam qayerdaligini** kuzatmoqchiman.

**Oddiy sahna:** Dilnoza 2 do'kondan 3 mahsulot savatga soladi → manzil kiritadi → Payme bilan
to'laydi → tizim buni **2 alohida posilkaga** bo'lib Elchi'ga topshiradi → ikkala do'kon ham
o'z posilkasini tayyorlaydi → Elchi yetkazadi.

### 3.3 👑 Platforma egasi (SUPERADMIN) va 🛡️ xodim (ADMIN)

Ikki xil boshqaruv: **egalar butun platformani**, xodimlar **kundalik moderatsiyani**.

**👑 Ega (SUPERADMIN) — hamma narsani nazorat qiladi:**
- Men **har accountni** (sotuvchi/xaridor/admin) ko'rib, faollashtirib/bloklab, rolini o'zgartirmoqchiman.
- Men **har do'konni** tasdiq/rad/to'xtatib, ichini (mahsulot, buyurtma, moliya) ko'rmoqchiman.
- Men **butun moliyani** — payout, komissiya, platforma daromadini boshqarmoqchiman.
- Men **hamma buyurtmani** bitta joydan kuzatib, kerak bo'lsa aralashmoqchiman.
- Men **komissiya, to'lov sozlamalari, admin jamoani** boshqarmoqchiman.

**🛡️ Xodim (ADMIN) — kundalik ish:**
- Men **yangi do'konlarni tasdiq/rad** qilaman, **muammoli do'konni to'xtataman**.
- Men **kategoriyalarni** boshqaraman, **buyurtmalarni** kuzataman, **support** beraman.
- (Moliya/sozlama/jamoaga ruxsatim yo'q — u faqat egada.)

**Oddiy sahna:** Yangi do'kon "PENDING" holatda keladi → admin ko'radi → "Tasdiqlash" bosadi →
do'kon ishga tushadi + Elchi'da akkaunt ochiladi. Ega esa oy oxirida barcha do'kon daromadini,
komissiyani va payout'larni bitta paneldan ko'rib, to'lovlarni tasdiqlaydi.

> **To'liq back-office spec:** `ADMIN_TZ.md` (rollar, qamrov matritsasi, 15 domen, MVP ajratmasi).

---

# B qism — Nima ishlashi kerak

## 4. Funksional talablar 👤💻

> Har funksiya: **nima qiladi** + **qabul mezoni** (tayyor deb hisoblanishi uchun sharti).
> Batafsil endpoint shakllari — `API_CONTRACT.md`.

### 4.1 Ro'yxatdan o'tish va kirish (auth)

| Talab | Tafsilot |
|---|---|
| Sotuvchi ro'yxati | Ism, telefon (`+998XXXXXXXXX`), parol, do'kon nomi, region bilan |
| Kirish | Telefon + parol → tokenlar (access + refresh) |
| Xavfsizlik | Parol **hech qachon ochiq saqlanmaydi** (hash); telefon **noyob** |
| OTP | **MVP'da yo'q** (sotuvchi baribir admin tasdiqidan o'tadi) |

**Qabul mezoni:** ro'yxatdan o'tgan sotuvchi holati `PENDING` (nofaol) bo'ladi; parol hash'langan;
takror telefon → xato (409); noto'g'ri parolda bir xil xato ("mavjudlikni oshkor qilmaslik").

### 4.2 Do'kon (shop)

| Talab | Tafsilot |
|---|---|
| Do'kon profili | Nom, tavsif, logotip, banner, telefon, region/tuman, manzil |
| Slug | Nomdan avtomat (`akmal-store`), noyob |
| Holatlar | `PENDING → ACTIVE` (tasdiq) · `REJECTED` · `ACTIVE ⇄ SUSPENDED` |

**Qabul mezoni:** sotuvchi faqat **o'z** do'konini tahrirlaydi (boshqasiniki → 403);
`slug/status/rating` — server boshqaradi, sotuvchi o'zgartira olmaydi.

### 4.3 Mahsulot va variant

| Talab | Tafsilot |
|---|---|
| Mahsulot | Nom, kategoriya, tavsif, narx, eski narx, **ko'p rasm**, atributlar |
| Variant | SKU (noyob), nom ("Qizil/M"), narx (bo'sh → mahsulot narxi), barcode, rasm |
| Qoida | Variantsiz mahsulotga ham server **1 ta "default" variant** yaratadi (sklad har doim variant bo'yicha) |
| Holatlar | `DRAFT → ACTIVE` · qoldiq 0 → `OUT_OF_STOCK` (avtomat) · `ARCHIVED` |

**Qabul mezoni:** SKU global noyob (takror → 409); mahsulot slug do'kon ichida noyob;
o'chirish — **soft-delete** (jismonan o'chmaydi).

### 4.4 Sklad (inventory)

| Talab | Tafsilot |
|---|---|
| Ko'p ombor | Sotuvchida bir necha ombor; birinchisi avtomat "default" |
| Qoldiq | Har (variant, ombor) uchun: `qo'ldagi`, `band qilingan`, `mavjud = qo'ldagi − band` |
| Kirim/tuzatish | Sotuvchi qo'lda kirim (`inbound`) va tuzatish (`adjust`) qiladi |
| Jurnal | Har o'zgarish **jurnalga** yoziladi (kim, qachon, sabab) |
| **Asosiy qoida** | `qo'ldagi − band ≥ 0` **har doim** (manfiy bo'lmaydi) |

**Qabul mezoni:** manfiy qoldiqqa olib keladigan amal → xato (422), holat **o'zgarmaydi**;
har amal jurnalda ko'rinadi; bir xil `idempotencyKey` 2 marta → 1 marta ta'sir.

### 4.5 Buyurtma va rezervatsiya *(Faza 2)*

| Talab | Tafsilot |
|---|---|
| Savat | Xaridor turli do'konlardan mahsulot yig'adi |
| Checkout | Savat → buyurtma; **do'kon bo'yicha bo'linadi** (har do'kon = 1 posilka) |
| Rezervatsiya | Buyurtma paytida qoldiq **band qilinadi** (TTL bilan) — oversell bo'lmaydi |
| Bekor/TTL | To'lanmasa yoki bekor bo'lsa — band **qaytariladi** |

**Qabul mezoni:** 2 do'konli savat → 2 posilka; qoldiq yetmasa → 422; band qilingan qoldiqni
boshqa xaridor **ololmaydi**; to'lov muddati o'tsa band avtomat bo'shaydi.

### 4.6 To'lov *(Faza 3)*

| Talab | Tafsilot |
|---|---|
| Onlayn | Payme (JSON-RPC) va Click (Prepare/Complete) |
| COD | Yetkazilganda kuryer naqd yig'adi |
| Xavfsizlik | Provayder maxfiy kalitlari **shifrlangan** (AES) saqlanadi |
| To'landi | Onlayn to'lov tasdiqlansa → buyurtma avtomat tasdiqlanadi va Elchi'ga ketadi |

**Qabul mezoni:** Payme sandbox to'lovi → buyurtma `PAID → CONFIRMED`; refund/qaytarish →
qoldiq qaytadi.

### 4.7 Yetkazish (Elchi integratsiyasi)

| Talab | Tafsilot |
|---|---|
| Do'kon provisioning | Do'kon tasdiqlanganda Elchi'da unga akkaunt ochiladi (`elchi_market_id`) |
| Shipment yaratish | Buyurtma tasdiqlanganda har do'kon uchun Elchi'da posilka ochiladi |
| COD summasi | Onlayn → `cod_amount=0` (prepaid); COD → `cod_amount=posilka summasi` |
| Status | Elchi webhook orqali holatni qaytaradi (yo'lda/yetkazildi/qaytdi) |

**Qabul mezoni:** tasdiqdan keyin do'konda `elchi_market_id` paydo bo'ladi; buyurtma
tasdiqlanganda Elchi'da posilka ochiladi; webhook kelganda buyurtma holati yangilanadi;
`returned` → qoldiq omborga qaytadi.

### 4.8 Admin / Platform back-office

> Egalar/xodimlar butun platformani boshqaradi. **To'liq qamrov, 15 domen va MVP ajratmasi:
> `ADMIN_TZ.md`.** Bu yerda qisqacha. Belgilar: ⭐ MVP · ◻︎ keyin.

| Domen | Nazorat | ⭐MVP |
|---|---|:--:|
| Dashboard | Platforma sanoqlari (do'kon/sotuvchi/buyurtma/GMV/daromad) | ⭐ |
| Accountlar | Ko'rish, bloklash/faollashtirish · rol/parol/o'chirish (◻︎) | ⭐ |
| Do'konlar | Ro'yxat + detail + **approve/reject/suspend/activate** (Elchi provisioning) | ⭐ |
| Kategoriyalar | Daraxt CRUD | ⭐ |
| Buyurtmalar | Hamma buyurtma ko'rish + drill-in · majburiy bekor/refund (◻︎) | ⭐ ko'rish |
| Katalog moderatsiya | Hamma mahsulot ko'rish · yashirish/flag (◻︎) | ⭐ ko'rish |
| Moliya (payout/komissiya) | Ledger, payout tasdiq/release, komissiya sozlash | ◻︎ |
| To'lovlar | Tranzaksiya nazorati, provayder config | ◻︎ |
| Elchi integratsiya | Shipment/webhook log, qayta provision | ◻︎ |
| Broadcast / kontent / sozlama / jamoa | E'lon, banner, feature flag, admin rol | ◻︎ |
| Audit log | Har xavfli admin amali yoziladi | ⭐ yozish |

- **Rollar:** 👑 SUPERADMIN (ega, hamma narsa) · 🛡️ ADMIN (moderatsiya; moliya/sozlama/jamoaga ruxsatsiz).
- **Qabul mezoni:** `PENDING` bo'lmagan do'konni approve → 409; Elchi provisioning muvaffaqiyatsiz →
  **hammasi rollback** (do'kon `PENDING`); har yozuv amali **audit'da**; xavfli amal faqat SUPERADMIN + confirm.

---

# C qism — Qanday ishlaydi (texnika)

## 5. Arxitektura 💻🤖

**Elchi Marketplace — ALOHIDA, mustaqil loyiha.** Elchi-Backend monorepo ichida EMAS.
O'z serveri, o'z bazasi, o'z git repo'si. Elchi bilan yagona bog'liqlik — **versiyalangan
HTTP kontrakt** (Partner API + webhook). Kodlar/domenlar aralashmaydi.

```
┌──────────────────────────────────────────────┐        ┌──────────────────────────────┐
│  ELCHI MARKETPLACE (alohida server)          │        │  ELCHI POCHTA (mavjud)       │
│                                              │        │                              │
│  Storefront (Next.js)  Seller cabinet (React)│        │  API Gateway                 │
│            │                    │            │        │  order/logistics/finance/... │
│            └────────┬───────────┘            │        │                              │
│              API Gateway                     │ HTTPS  │  ┌ Partner API (YANGI) ─────┐ │
│                 │ RMQ (cmd)                  │ ─────► │  │ POST /partner/markets    │ │
│  identity  catalog  inventory  checkout      │ship-   │  │ POST /partner/shipments  │ │→ order.create
│  payment   finance  notification  search     │ment    │  │ GET/POST .../:id[/cancel]│ │
│                 │                            │        │  └ Outbound webhook ───────┘ │→ status push
│         elchi-integration (Partner API klient)◄────── │     (sold/cancel/returned)   │
│                                              │webhook └──────────────────────────────┘
│  Postgres (schema-per-service) · RabbitMQ ·  │
│  MinIO (media)                               │
└──────────────────────────────────────────────┘
```

**Nega alohida loyiha (qisqa):** toza chegara (marketplace domeni ≠ dostavka domeni);
mustaqil deploy/scale (Black Friday yuklamasi Elchi dostavkasiga xavf solmaydi); ikki
jamoa bir-birini buzmaydi; Elchi'ning sinovdan o'tgan patternlari qayta ishlatiladi.

**Konvensiyalar (Elchi'dan meros):**
- Servislar RabbitMQ orqali gaplashadi — xabar patterni `{cmd: '<servis>.<amal>'}`.
- Har javob bir xil qobiqda: `{ statusCode, message, data }`.
- Har servis o'z schema'siga ega (schema-per-service).
- Kirish nazorati: JWT + RolesGuard.

**Texnologiyalar:**

| Qatlam | Texnologiya |
|---|---|
| Til / runtime | TypeScript, Node.js ≥ 20 |
| Framework | NestJS 11 (monorepo: `apps/` + `libs/`) |
| Xabar shinasi | RabbitMQ |
| ORM / baza | TypeORM 0.3 · PostgreSQL 16 |
| Media | MinIO (S3-mos) |
| Auth | JWT (access 1s + refresh 7kun), bcryptjs |
| Frontend (ichki panel) | **React SPA** (Vite + React 19 + antd): seller-cabinet **+ admin** (ADMIN-role bo'lim) |
| Frontend (ochiq sayt) | **Next.js** (SSR/SEO): storefront (Faza 2) |
| Sifat | ESLint 9 + Prettier + husky + GitHub Actions CI |

> **Frontend tamoyili (qaror 2026-07):** tex ekranning vazifasiga qarab — **SEO kerakmi?**
> Ochiq storefront (Google trafik) → **Next.js (SSR)**. Login ortidagi panellar (cabinet +
> admin) → **React SPA (Vite + antd)**, bir theme'ni ulashadi. Admin — alohida app emas,
> cabinet ichida **ADMIN-role** bo'lim. 3 tex emas — 2 profil (SPA + Next).

---

## 6. Servislar 💻🤖

| Servis | Schema | Egalik qiladi | Vazifa |
|---|---|---|---|
| **api-gateway** | — | — | HTTP→RMQ, JWT/RBAC, public storefront, Elchi webhook qabul qilish |
| **identity-service** | `identity` | `users` | Seller/buyer/admin userlar; auth (JWT) |
| **catalog-service** | `catalog` | `shop`, `category`, `product`, `product_variant` | Do'kon, kategoriya, katalog, variant |
| **inventory-service** | `inventory` | `warehouse`, `stock`, `stock_movement`, `reservation` | Ko'p ombor, qoldiq, jurnal, rezervatsiya |
| **checkout-service** | `checkout` | `cart`, `sales_order`, `sales_order_seller`, `sales_order_item` | Savat, checkout, ko'p-sotuvchi split |
| **payment-service** | `payment` | `payment`, `payment_transaction`, `provider_config` | Payme/Click, escrow, refund |
| **finance-service** | `finance` | `seller_ledger`, `payout`, `commission` | Onlayn escrow → payout, komissiya |
| **elchi-integration** | `integration` | `elchi_shipment`, `geo_cache` | Elchi Partner API klienti |
| **notification-service** | `notification` | `notification` | Email/SMS/telegram/in-app xabar |
| **search-service** | `search` | `search_document` | Katalog qidiruv/filter |
| **file-service** | — (MinIO) | — | Mahsulot media (ko'p rasm) |

> **Muhim:** `identity`, `finance`, `notification`, `search` — Elchi'dagi bir nomli
> servislarga **o'xshash lekin ALOHIDA** (o'z bazasi, o'z userlari). Elchi bilan faqat
> `elchi-integration` gaplashadi.

**Baza topologiyasi (qaror):** hozircha **1 ta PostgreSQL + 9 schema** (schema-per-service),
fizik alohida baza emas. Qoidalar: servislararo **fizik FK yaratilmaydi** (faqat mantiqiy
bog'lanish — bigint id + API/event orqali); har servisga **alohida DB user** faqat o'z
schema'siga ruxsatli (least-privilege). Sabab va ko'chirish rejasi: `adr/0001-database-topology.md`.

---

## 7. Ma'lumotlar modeli 💻🤖

> To'liq DDL: `schema/` papkasi (servis bo'yicha) va `schema.sql` (birlashgan).
> Bu yerda faqat **yuqori darajali xarita**. Barcha jadval `BaseEntity`dan meros oladi:
> `id` (bigint, JSON'da **string**), `created_at`, `updated_at`, `is_deleted` (soft-delete).
> Pul — `numeric(14,2)`, valyuta **UZS**.

**Bog'lanishlar xaritasi (mantiqiy, cross-schema FK yo'q):**

```
users (identity)
  └─ owner_user_id ─► shop (catalog)
                        ├─ shop_id ─► product ─► product_variant
                        └─ elchi_market_id ─► [Elchi]
product_variant (catalog)
  └─ variant_id ─► stock (inventory) ─┬─ warehouse_id ─► warehouse
                                      └─ stock_movement (jurnal)
cart (checkout) ─► sales_order ─┬─ sales_order_seller ─► sales_order_item
                                │        └─ elchi_shipment_id ─► elchi_shipment (integration)
                                ├─ reservation_id ─► reservation (inventory)
                                └─ payment_id ─► payment (payment)
sales_order_seller (checkout)
  └─ delivered+online ─► seller_ledger / payout (finance)
```

**Asosiy invariantlar (buzilmaydigan qoidalar):**
- `stock.on_hand − stock.reserved ≥ 0` — har doim (oversell yo'q).
- `sales_order` — pulning yagona manbasi (money source of truth).
- Har `product_variant` — kamida 1 ta stock qatoriga ega bo'lishi mumkin (ombor bo'yicha).
- Pul hech qachon `float` emas — `numeric` + `numericTransformer` (drift yo'q).

Jadvallarning to'liq maydonlari: `MARKETPLACE_PLAN.md §5`.

---

## 8. Muhim jarayonlar (flow) 💻🤖

### 8.1 Sotuvchi onboarding

```
1. Public:  POST /sellers/register {name, phone, password, shop_name, region_id}
              → identity: user(role=seller, inactive) + catalog: shop(status=pending)
              → notification → admin
2. Admin:   POST /admin/shops/:id/approve
              → user.active, shop.active
              → inventory: default warehouse yaratiladi
              → elchi-integration: POST /partner/markets → shop.elchi_market_id saqlanadi
3. Seller login → seller-cabinet.  (tasdiqgacha storefront'da ko'rinmaydi)
```

### 8.2 Rezervatsiya — oversell'ni imkonsiz qilish

Barchasi **bitta tranzaksiya**, `libs/common` idempotency + outbox bilan.

```
RESERVE (checkout paytida):
   tx: har item uchun SELECT ... FOR UPDATE (qatorni qulflab)
       available = on_hand − reserved
       IF available < qty  → THROW (422 INSUFFICIENT_STOCK)
       reserved += qty; movement(reserve); reservation(held, expires=now+ttl)
   → idempotent: order_ref bo'yicha 2 marta chaqirsa 1 marta ta'sir

COMMIT (buyurtma tasdiqlanganda):
   on_hand −= qty; reserved −= qty; movement(commit); reservation=committed
   IF on_hand == 0  → variant/product = OUT_OF_STOCK (event → catalog)

RELEASE (bekor / TTL tugadi):
   reserved −= qty; movement(release); reservation = released | expired

SWEEPER (cron):  held & expires_at < now  → release(expired)
QAYTGAN TOVAR:   Elchi webhook 'returned'  → inventory.inbound (on_hand tiklanadi)
```

### 8.3 Checkout → Elchi shipment (ko'p-sotuvchi split)

```
POST /checkout {cart_id, address, region, district, where_deliver, payment_method}
1. cart_item'lar shop_id bo'yicha guruhlanadi → N ta sales_order_seller
2. sales_order (online→pending_payment | COD→draft) + sub-order + item yoziladi
3. inventory.reserve {order_ref=sales_order_id, ttl=30daq}
4. COD    → confirmSalesOrder()  (to'lovsiz)
   online → payment.create → to'lov sahifasi → payment.paid → confirmSalesOrder()

confirmSalesOrder():
   har sales_order_seller uchun:
     elchi-integration → POST /partner/shipments {
        external_order_id: seller.id,
        elchi_market_id:   shop.elchi_market_id,
        customer:{name,phone}, address, region_id, district_id, where_deliver,
        items:[{name, quantity}],
        cod_amount: (online ? 0 : seller.subtotal)   // 0 = prepaid
     } → {shipment_id} → seller.elchi_shipment_id
   inventory.commit {order_ref=sales_order_id}
   sales_order = confirmed
   notification → sotuvchi(lar) + xaridor

Elchi webhook (status_changed) → sales_order_seller status yangilanadi
   'returned'          → inventory.inbound
   'delivered'+online  → finance payout trigger
```

**Muhim:** har sotuvchi = alohida Elchi posilkasi. Elchi ichida region bo'yicha filialga
yo'nalish **avtomat** (marketplace buni bilmaydi).

### 8.4 Pul modeli (aralash)

| Yo'l | Pulni kim yig'adi | Sotuvchiga to'lov | Komissiya |
|---|---|---|---|
| **Online** | Marketplace (Payme/Click escrow) | Marketplace `finance` payout (`delivered`dan keyin) | Payout'dan ushlanadi |
| **COD** | Elchi kuryer | **Elchi** to'g'ridan per-seller akkauntga (mavjud settlement) | ⚠️ §13.1 (davriy invoys / netting) |

---

## 9. API qoidalari 💻🤖

> To'liq endpoint DTO'lari, xato kodlari, auth spec: **`API_CONTRACT.md`**. Bu yerda faqat
> hamma uchun umumiy qoidalar.

- **Base URL:** `.../api/v1` (breaking o'zgarish → `/api/v2`). Format: JSON.
- **Auth:** `Authorization: Bearer <access_jwt>`. Public'dan tashqari hamma talab qiladi.
- **Muvaffaqiyat (envelope):** `{ statusCode, message, data }` — barcha 2xx bir xil.
- **Pagination:** `?page=1&limit=20&sort=field:desc&search=...` → `{items,total,page,limit,totalPages}`.
- **Xato:** `{ statusCode, message, errorCode, details? }` — barcha 4xx/5xx bir xil.
- **JWT claim:** `sub` (user id), `role`, `shopId` (faqat seller). Access 1s, refresh 7kun (rotation).

**Barqaror `errorCode` lug'ati (qisqa):**

| HTTP | errorCode | Qachon |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body/query validatsiyadan o'tmadi |
| 401 | `UNAUTHENTICATED` | Token yo'q / yaroqsiz / muddati o'tgan |
| 403 | `FORBIDDEN` | Rol yetmaydi yoki o'zganing resursi |
| 404 | `NOT_FOUND` | Resurs topilmadi |
| 409 | `CONFLICT` / `INVALID_STATE` | Dublikat / state machine ruxsat bermaydi |
| 422 | `INSUFFICIENT_STOCK` | Qoldiq yetmaydi |
| 429 | `RATE_LIMITED` | Limit oshdi |
| 500 | `INTERNAL_ERROR` | Kutilmagan xato |

**Maydon qoidalari:** `id` — string; pul — number (UZS, manfiy emas); `phone` — `+998XXXXXXXXX`;
`slug` — `^[a-z0-9]+(-[a-z0-9]+)*$`; sana — ISO-8601 UTC; enum — UPPERCASE.

---

## 10. Non-funksional talablar (sifat) 💻🤖

| Yo'nalish | Talab |
|---|---|
| **Xavfsizlik** | Parol hash (bcryptjs); provayder kaliti AES-shifrlangan; tashqi URL SSRF-guard; webhook HMAC + timestamp oynasi (replay himoya); `.env` **hech qachon** git'ga tushmaydi |
| **Kirish nazorati** | RBAC (SELLER/BUYER/ADMIN/SUPERADMIN); SelfGuard (o'zganing resursi → 403) |
| **Ishonchlilik** | Idempotency (takror xabar → 1 ta ta'sir); outbox (event 1 marta yuboriladi); soft-delete; tranzaksiya + rollback |
| **Ma'lumot butunligi** | Cross-schema fizik FK yo'q; pul `numeric` (float emas); stock invariant |
| **Tezlik** | Rate-limit (auth 10/daq/IP, boshqa 120/daq/user); pagination majburiy; qidiruv indekslangan |
| **Kuzatuvchanlik** | Har muhim amal jurnalda (activity-log); xato log'da to'liq, javobda qisqa |
| **Kod sifati** | ESLint + Prettier + husky (commit'dan oldin tekshiruv) + CI (lint/format/build/test) |
| **Testlanuvchanlik** | Har task oxirida test-case'lar (TC1/TC2 "qadam → kutilgan natija"); Done'dan oldin hammasi ✓ |

---

# D qism — Reja va boshqaruv

## 11. Fazalar va muddat 👤💻

| Faza | Ish | Qabul mezoni | Taxminiy |
|---|---|---|---|
| **0. Skelet + poydevor** ✅ | Monorepo, `libs/common`, identity, docker, CI | `reserve→commit→release` testlari yashil; oversell imkonsiz | Bajarildi |
| **1. Sotuvchi kabineti + admin MVP** ⭐ | register→approve; product+variant+media; inventory; seller order/dashboard; Elchi provisioning; **admin: dashboard/shops/users/orders(ko'rish)/kategoriya + audit yozish** | Sotuvchi ro'yxat→tasdiq→mahsulot+qoldiq; Elchi akkaunt; **admin do'kon tasdiqlaydi, hamma buyurtmani ko'radi** | ~2-3 hafta |
| **2. Storefront + checkout** | Public katalog/qidiruv; savat; checkout split; shipment ko'prigi; webhook; **admin: mahsulot moderatsiya, buyurtma bekor, broadcast, audit UI** | 2 do'konli savat → 2 shipment; qoldiq kamayadi; webhook yangilaydi | ~2-3 hafta |
| **3. Onlayn to'lov + moliya back-office** | Payme + Click; `payment.paid`→confirm; **admin: to'lov nazorati, payout tasdiq/release, komissiya sozlash, reconciliation** | Payme sandbox → shipment avtomat; refund → qoldiq qaytadi; **ega payout tasdiqlaydi** | ~2 hafta |
| **4. Sayqal** | Review/rating; qaytarish UI; COD komissiya reconciliation; **admin: impersonation, jamoa+permission, sozlama/feature flag, kontent, chuqur analitika** | Sharh; payout hisobot; COD komissiya undiriladi | ~2 hafta |

**Jamoa (3 kishi, Dush–Juma):** L=Lead/full-stack (infra, libs, identity, Elchi API, review),
Dilshodbek=Backend (inventory, catalog, checkout, payment, finance), Bahodir=Frontend
(seller-cabinet, storefront, admin). Ish Trello orqali (Backlog→Sprint→In Progress→Review→Done).

**Elchi tomonida parallel:** `../Elchi-Backend/docs/PARTNER_API.md` — Partner API + webhook
(Faza 1–2 uchun kerak).

---

## 12. Qabul mezoni (Definition of Done) 👤💻

Bir task **"Done"** bo'lishi uchun:

1. ✅ Kod yozilgan va ishlaydi (kutilgan natija chiqadi).
2. ✅ Task oxiridagi **barcha test-case'lar (checklist)** qo'lda/avtomat tekshirilgan va ✓ belgilangan.
3. ✅ Lint + format + build + test **yashil** (CI o'tadi).
4. ✅ Kod review'dan o'tgan (Lead tasdiqlagan).
5. ✅ Kerak bo'lsa hujjat yangilangan (`MARKETPLACE_PLAN.md` / `API_CONTRACT.md` / bu TZ).
6. ✅ `.env`, maxfiy kalitlar commit qilinmagan.

> **Qat'iy qoida:** test checklist 100% ✓ bo'lmasa — card **Done'ga o'tmaydi**.

---

## 13. Xatarlar va ochiq savollar 💻

1. **COD komissiya** — pul to'g'ridan sotuvchiga (Elchi orqali) ketganda komissiya qanday undiriladi?
   Variantlar: (a) davriy invoys, (b) onlayn payout'dan netting, (c) Elchi ushlab beradi
   (tavsiya etilmaydi). *MVP: (a)/(b).*
2. **Guest checkout** — xaridor ro'yxatsiz sotib olsinmi? (telefon bo'yicha yengil buyer).
3. **Dostavka narxi** — kim to'laydi (buyer/seller/split)? Ko'p-sotuvchili savatda har posilkaga alohida.
4. **Geo moslashuv** — marketplace manzili → Elchi region/district id (geo_cache sync).
5. **Search** — mavjud pattern yetarlimi yoki Meilisearch/Elastic (facet/filter uchun)?
6. **Media** — bir mahsulotga ko'p rasm (MinIO/S3 hajm/optimallashtirish).

To'liq ro'yxat va tafsilot: `MARKETPLACE_PLAN.md §16`.

---

## 14. Hujjatlar xaritasi 👤💻🤖

> Qaysi savolga qaysi fayl javob beradi.

| Fayl | Nima uchun | Kim o'qiydi |
|---|---|---|
| **`TZ.md`** (bu fayl) | Butun loyihaga kirish, hamma uchun bosh hujjat | 👤💻🤖 hamma |
| `MARKETPLACE_PLAN.md` | To'liq PRD: model/enum/state machine/flow batafsil | 💻🤖 dasturchi/AI |
| `API_CONTRACT.md` | Har endpoint request/response/xato aniq shakli (§8 = admin) | 💻 FE+BE dasturchi |
| `ADMIN_TZ.md` | Admin/back-office: rollar, qamrov matritsasi, 15 domen, MVP ajratmasi | 👤💻🤖 ega/dasturchi |
| `DESIGN_TZ.md` | Seller-cabinet + admin dizayn TZ: tokenlar, antd theme, ekranlar, AI prompt | 🎨🤖 dizayner/AI |
| `schema/` + `schema.sql` | Baza jadvallari (DDL), ERD | 💻🤖 dasturchi/AI |
| `adr/0001-database-topology.md` | Nega 1 baza + 9 schema; ko'chirish rejasi | 💻 arxitektor |
| `TRELLO_BOARD.md` | Barcha tasklar, muddat, mas'ul, test-case | 👤💻 jamoa |
| `../Elchi-Backend/docs/PARTNER_API.md` | Elchi tomonidagi integratsiya kontrakti | 💻 ikki jamoa |

**Yangilash qoidasi (muhim):** entity / pattern / enum / route / flow o'zgarsa — tegishli
faylni **darhol** yangilang. Ziddiyatda manba: model/enum → `MARKETPLACE_PLAN.md`, API shakli
→ `API_CONTRACT.md`, umumiy g'oya → shu `TZ.md`.

---

*Bu hujjat tirik — loyiha o'zgargani sari yangilanadi. Savol/taklif bo'lsa jamoa bilan muhokama qiling.*
