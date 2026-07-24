# Elchi Marketplace — Admin / Platform Back-office TZ

> **Bu hujjat nima?** Platforma **egalari** (siz) va **xodimlaringiz** uchun boshqaruv markazi
> (back-office). Bu yerda **hamma narsa** nazorat qilinadi: har account, har do'kon, har
> buyurtma, butun moliya, komissiya, integratsiya. Sotuvchi o'z do'konini boshqaradi —
> **egalar butun platformani** boshqaradi.
>
> **Bog'liq:** `TZ.md` (umumiy), `API_CONTRACT.md §8` (endpoint shakllari),
> `DESIGN_TZ.md §11` (admin ekranlari). Ma'lumot manbasi — `MARKETPLACE_PLAN.md §5/§6`.

Holat: **DRAFT** · 2026-07 · **Belgilar:** 👤 hamma/PM · 💻 dasturchi · 🤖 AI · 🎨 dizayn

**Qamrov belgisi:** ⭐ **MVP** (birinchi qilinadi) · ◻︎ **keyin** (faza 2+). Bu hujjat
**to'liq** vizyonni yozadi; jamoa **⭐ MVP** dan boshlaydi, qolganini bosqichma-bosqich qo'shadi.

---

## 0. Bir qarashda 👤

**Nima:** login ortidagi boshqaruv paneli — platforma egalari/xodimlari uchun. Sotuvchi
kabinetiga o'xshaydi, lekin **bitta do'kon emas — butun platforma** ko'lamida.

**Kim ishlatadi (2 tur admin):**
- 👑 **SUPERADMIN (Ega)** — hamma narsaga to'liq ruxsat: moliya, payout, komissiya, admin
  jamoa, platforma sozlamalari, provayder kalitlari, impersonation.
- 🛡️ **ADMIN (Xodim / Moderator)** — kundalik ish: do'kon moderatsiyasi, buyurtma nazorati,
  account boshqaruvi, support. Moliya/sozlama/jamoaga ruxsat **yo'q**.

**Qayerda:** seller-cabinet ilovasi **ichida** `ADMIN`/`SUPERADMIN` rol bilan ochiladigan
bo'lim (React SPA). Platforma o'sganda alohida app'ga ajratiladi (§9).

**Asosiy tamoyillar:**
1. **Har servis o'z datasini beradi.** Admin gateway orqali servislararo (cross-service)
   so'rov yuboradi — to'g'ridan boshqa schema'ga tegmaydi.
2. **Har admin amali audit log'ga yoziladi** (kim, nima, qachon, eski→yangi qiymat).
3. **Least-privilege.** ADMIN faqat kerakli narsani ko'radi; xavfli amallar (payout, cred,
   o'chirish) faqat SUPERADMIN + tasdiq (confirm) bilan.
4. **Xavfli amal — qaytariladigan.** Iloji boricha soft-delete, bekor qilish, tarix.

---

## 1. Rollar va ruxsatlar (RBAC) 💻🤖

Enum: `Role { SELLER, BUYER, ADMIN, SUPERADMIN }` (`libs/common/enums`).

| Imkoniyat | SUPERADMIN 👑 | ADMIN 🛡️ |
|---|:--:|:--:|
| Platforma dashboard, hisobotlar | ✅ | ✅ |
| Account: ko'rish, faollashtirish/bloklash | ✅ | ✅ |
| Account: rol o'zgartirish, o'chirish | ✅ | ❌ |
| Do'kon: tasdiq/rad/to'xtatish | ✅ | ✅ |
| Katalog/mahsulot moderatsiya | ✅ | ✅ |
| Kategoriya boshqarish | ✅ | ✅ |
| Buyurtma: ko'rish | ✅ | ✅ |
| Buyurtma: majburiy bekor/refund | ✅ | ⚠️ (ruxsat berilsa) |
| **Moliya: payout tasdiq/release** | ✅ | ❌ |
| **Komissiya sozlash** | ✅ | ❌ |
| **To'lov provayder kaliti (Payme/Click)** | ✅ | ❌ |
| Bildirishnoma / broadcast | ✅ | ✅ |
| Impersonation (sotuvchi nomidan) | ✅ | ⚠️ (ruxsat berilsa) |
| **Admin jamoa (rol berish/olish)** | ✅ | ❌ |
| **Platforma sozlamalari / feature flag** | ✅ | ❌ |
| Audit log ko'rish | ✅ | ⚠️ (o'ziniki) |

- ⭐ **MVP:** 2 rol yetarli (SUPERADMIN, ADMIN), yuqoridagi bo'linish bilan.
- ◻︎ **Keyin:** granular ruxsat (masalan `finance-viewer`, `support-agent`) — permission
  ro'yxati bilan, rol ustiga qo'shiladi.

---

## 2. Nazorat qamrovi — capability matrix 👤💻

> "Egalar hamma narsani nazorat qiladi" — quyida aynan **nima**ni nazorat qilishi.
> **K** = ko'rish (read), **B** = boshqarish (yozish/amal).

| # | Domen | Nazorat (K/B) | ⭐MVP |
|---|---|---|:--:|
| 1 | **Accountlar** (seller/buyer/admin) | K: hammasi · B: faollashtirish, bloklash, rol, parol tiklash, o'chirish | ⭐ (ko'rish+bloklash) |
| 2 | **Do'konlar** (shops) | K: hammasi · B: tasdiq, rad, to'xtatish, qayta faollashtirish, tahrir, tavsiya (featured) | ⭐ |
| 3 | **Katalog / mahsulot** | K: hamma mahsulot · B: yashirish, flag, arxiv (moderatsiya) | ⭐ (ko'rish) / ◻︎ (moderatsiya) |
| 4 | **Kategoriyalar** | K/B: daraxt CRUD, atribut | ⭐ |
| 5 | **Buyurtmalar** (hamma sotuvchi) | K: hammasi + drill-in · B: majburiy bekor, refund, nizo yechish | ⭐ (ko'rish) / ◻︎ (amal) |
| 6 | **Sklad** (har do'kon) | K: qoldiq/jurnal · B: support uchun tuzatish | ◻︎ |
| 7 | **To'lovlar** | K: hamma tranzaksiya · B: qo'lda tekshirish, provayder config | ◻︎ |
| 8 | **Moliya: payout** | K: seller ledger, payout · B: tasdiq/ushlash/release | ◻︎ |
| 9 | **Komissiya** | K/B: global/kategoriya/do'kon bo'yicha stavka | ◻︎ |
| 10 | **Elchi integratsiya** | K: shipment/webhook loglar · B: qayta provision, geo sync | ◻︎ |
| 11 | **Bildirishnoma / broadcast** | B: sotuvchi/xaridorga e'lon, shablon | ◻︎ |
| 12 | **Kontent / bannerlar** | B: bosh sahifa, banner, promo | ◻︎ |
| 13 | **Platforma sozlamalari** | B: komissiya default, rate-limit, feature flag, dostavka narx siyosati | ◻︎ |
| 14 | **Admin jamoa** | K/B: admin qo'shish, rol, o'chirish | ◻︎ |
| 15 | **Audit log** | K: hamma admin amali (immutable) | ⭐ (yozish) / ◻︎ (UI) |
| 16 | **Analitika** | K: GMV, daromad, o'sish, top do'kon/mahsulot | ⭐ (asosiy) / ◻︎ (chuqur) |

---

## 3. Funksional talablar (domen bo'yicha) 💻🤖

> Har biri: **maqsad · amallar · ⭐/◻︎ · API · qabul mezoni**. Endpoint shakllari — `API_CONTRACT §8`.

### 3.1 Platforma dashboard
- **Maqsad:** platforma sog'lig'i bir qarashda.
- **Ko'rsatkichlar ⭐:** jami do'kon (holat bo'yicha), jami sotuvchi/xaridor, jami buyurtma,
  GMV (umumiy aylanma), platforma daromadi (komissiya), kutilayotgan moderatsiya soni.
- **◻︎ Keyin:** o'sish grafiklari (kunlik/oylik), top do'konlar, top mahsulotlar, konversiya,
  hududlar bo'yicha xarita, ogohlantirishlar (anomaliya).
- **API:** `GET /admin/dashboard`. **Qabul:** yangi platformada nol/bo'sh (xato emas).

### 3.2 Accountlar (userlar)
- **Maqsad:** har foydalanuvchini (seller/buyer/admin) ko'rish va boshqarish.
- **Amallar:** ro'yxat (rol/holat/qidiruv filtri) ⭐ · profil ko'rish ⭐ ·
  faollashtirish/bloklash (ban) ⭐ · parol tiklash ◻︎ · rol o'zgartirish (SUPERADMIN) ◻︎ ·
  o'chirish (soft, SUPERADMIN) ◻︎ · user faoliyati/audit ◻︎.
- **API:** `GET /admin/users`, `GET /admin/users/:id`, `POST /admin/users/:id/block|unblock`, `.../reset-password`, `PATCH .../role`.
- **Qabul:** bloklangan user kira olmaydi (401); o'zini bloklab bo'lmaydi; rol o'zgarishi audit'da.

### 3.3 Do'konlar (shops) ⭐
- **Maqsad:** do'konlarni moderatsiya va boshqarish.
- **Amallar:** ro'yxat (holat/qidiruv) ⭐ · to'liq detail (mahsulot, buyurtma, moliya, ombor) ⭐ ·
  **tasdiq (approve)** ⭐ · **rad (reject, sabab)** ⭐ · **to'xtatish (suspend)** ⭐ ·
  qayta faollashtirish ⭐ · profil tahrir ◻︎ · komissiya belgilash ◻︎ · tavsiya (featured) ◻︎.
- **Muhim (approve ketma-ketligi):** `user.active` + `shop.active` + default ombor +
  Elchi `POST /partner/markets` → `elchiMarketId`. Elchi xato → **rollback** (§API_CONTRACT 8).
- **API:** `GET /admin/shops`, `GET /admin/shops/:id`, `POST .../approve|reject|suspend|activate`.
- **Qabul:** `PENDING` bo'lmaganni approve → 409; suspend qilinsa mahsulotlari storefront'da yashirinadi.

### 3.4 Katalog & mahsulot moderatsiya
- **Maqsad:** platformadagi barcha mahsulotlarni ko'rish/moderatsiya.
- **Amallar:** hamma mahsulot ro'yxati (do'kon/kategoriya/holat) ⭐ ko'rish · yashirish/flag ◻︎ ·
  arxiv ◻︎ · taqiqlangan tovar qoidalari ◻︎.
- **API:** `GET /admin/products`, `POST /admin/products/:id/hide|flag`.

### 3.5 Kategoriyalar ⭐
- **Maqsad:** katalog daraxtini boshqarish.
- **Amallar:** daraxt CRUD (qo'shish/tahrir/o'chirish), ikonka, tartib, faol/nofaol; atribut ◻︎.
- **API:** `GET/POST/PATCH/DELETE /admin/categories`. **Qabul:** dublikat slug → 409;
  bola (child) bor kategoriyani o'chirishda ogohlantirish.

### 3.6 Buyurtmalar (butun platforma)
- **Maqsad:** hamma sotuvchining barcha buyurtmasini bitta joydan nazorat.
- **Amallar:** ro'yxat (holat/sana/to'lov/do'kon/qidiruv) ⭐ · drill-in (sub-buyurtma +
  shipment + to'lov + tarix) ⭐ · majburiy bekor ◻︎ · refund boshlash ◻︎ · nizo yechish ◻︎.
- **API:** `GET /admin/orders`, `GET /admin/orders/:id`, `POST .../cancel|refund`.

### 3.7 Sklad nazorati ◻︎
- Har do'kon qoldig'i/jurnalini ko'rish; support uchun tuzatish (audit bilan).
- **API:** `GET /admin/inventory/stock`, `GET .../movements`.

### 3.8 To'lovlar ◻︎
- Hamma tranzaksiya (Payme/Click) ko'rish/qidiruv; qo'lda tekshirish/moslash;
  provayder config (AES-shifrlangan kalit) — faqat SUPERADMIN.
- **API:** `GET /admin/payments`, `GET/PUT /admin/payments/providers`.

### 3.9 Moliya: payout + komissiya ◻︎
- **Payout:** seller ledger, kutilayotgan/bajarilgan payout; tasdiq/ushlash/release
  (faqat SUPERADMIN). Onlayn escrow → `delivered` dan keyin.
- **Komissiya:** global default + kategoriya + do'kon bo'yicha stavka (percent/fixed).
- **Hisobot:** platforma daromadi, COD vs online reconciliation.
- **API:** `GET /admin/finance/ledger|payouts`, `POST /admin/finance/payouts/:id/approve|hold|release`,
  `GET/POST/PATCH /admin/finance/commissions`.
- **Qabul:** payout ikki marta release bo'lmaydi (idempotent); har o'zgarish ledger + audit'da.

### 3.10 Elchi integratsiya nazorati ◻︎
- Shipment statuslari, webhook loglari (kelgan/qayta ishlangan), xato bo'lsa **qayta
  provision / qayta yuborish**; geo_cache sync.
- **API:** `GET /admin/integration/shipments|webhooks`, `POST .../shops/:id/reprovision`.

### 3.11 Bildirishnoma / broadcast ◻︎
- Sotuvchi/xaridor guruhiga e'lon (email/SMS/telegram/in-app); shablon; yuborish tarixi.
- **API:** `POST /admin/broadcast`, `GET /admin/notifications/templates`.

### 3.12 Kontent / bannerlar ◻︎
- Storefront bosh sahifa: banner, tanlangan do'kon/mahsulot, promo bloklar.
- **API:** `GET/POST/PATCH/DELETE /admin/content/banners`.

### 3.13 Platforma sozlamalari ◻︎
- Komissiya default, rate-limit, feature flag, dostavka narx siyosati, valyuta ko'rinishi.
- **API:** `GET/PUT /admin/settings`. Faqat SUPERADMIN.

### 3.14 Admin jamoa ◻︎
- Admin qo'shish/o'chirish, rol berish (ADMIN/SUPERADMIN); (keyin) granular permission.
- **API:** `GET/POST /admin/team`, `PATCH /admin/team/:id/role`, `DELETE /admin/team/:id`.
- **Qabul:** oxirgi SUPERADMIN o'chirilmaydi/pasaymaydi (o'zini qulflab qo'ymaslik).

### 3.15 Audit log
- **Maqsad:** har admin amali immutable tarixda — "kim, nima, qachon, eski→yangi".
- ⭐ **MVP:** har xavfli admin amali **yoziladi** (`activity-log`, libs/common). ◻︎ Keyin: UI (filtr/qidiruv/eksport).
- **API:** `GET /admin/audit` (◻︎ UI). **Qabul:** yozuv o'zgartirilmaydi/o'chirilmaydi.

---

## 4. Impersonation & support 🛡️ ◻︎

Support uchun admin **sotuvchi nomidan** kabinetni ko'ra oladi (login as).
- Faqat SUPERADMIN yoki ruxsatli ADMIN; **audit'ga majburiy yoziladi** (kim, kimni, qachon,
  qancha vaqt); alohida "impersonation" token (cheklangan muddat); banner "Siz X nomidan
  ko'ryapsiz". Xavfli amal (parol/payout) impersonation'da **bloklanadi**.
- **API:** `POST /admin/users/:id/impersonate` → cheklangan token.

---

## 5. Ekranlar 🎨

Admin ekranlari seller-cabinet dizayn tizimini (`DESIGN_TZ.md`) qayta ishlatadi — bir xil
token/komponent, lekin admin urg'usi (masalan boshqacha aksent yoki "ADMIN" belgisi).
To'liq ro'yxat va wireframe: **`DESIGN_TZ.md §11`**.

Asosiy ekranlar: Admin dashboard · Accountlar · Do'konlar (+ detail) · Buyurtmalar · Kategoriyalar
· (keyin) Moliya/Payout · Komissiya · To'lovlar · Integratsiya · Broadcast · Sozlamalar · Admin
jamoa · Audit log.

---

## 6. API surface 💻

Barcha admin endpoint'lar `/admin/*` prefiksi ostida, `ADMIN|SUPERADMIN` rol talab qiladi
(xavfli amallar faqat `SUPERADMIN`). To'liq request/response/xato shakllari: **`API_CONTRACT §8`**.

---

## 7. Xavfsizlik (admin-specific) 💻🤖

- **Rol tekshiruvi backend'da** (RolesGuard) — UI yashirish yetarli emas; har `/admin/*`
  handler rolni qayta tekshiradi.
- **Audit** — har yozuv amali (§3.15). **Confirm** — o'chirish/payout/rol kabi amallar tasdiq bilan.
- **Provayder kaliti** — AES-shifrlangan, faqat SUPERADMIN, javobda **hech qachon ochiq emas**.
- ◻︎ **Keyin:** 2FA (admin uchun majburiy), IP allowlist, admin sessiya qisqaroq muddat,
  alohida domen (`admin.marketplace.uz`).

---

## 8. MVP vs to'liq — aniq ajratma 👤

> **Bu bo'lim eng muhim:** butun spec to'liq, lekin jamoa quyidagi **⭐ MVP** dan boshlaydi.

**⭐ MVP admin (Faza 1 bilan birga):**
1. Admin auth — `ADMIN`/`SUPERADMIN` rol (seeder SUPERADMIN allaqachon bor).
2. Do'konlar: ro'yxat + detail + **approve/reject/suspend/activate** (Elchi provisioning bilan).
3. Accountlar: ro'yxat + ko'rish + **bloklash/faollashtirish**.
4. Kategoriyalar: daraxt CRUD.
5. Buyurtmalar: hamma buyurtma **ko'rish** + drill-in (read-only).
6. Asosiy dashboard: sanoqlar (do'kon/sotuvchi/buyurtma/GMV).
7. Audit: xavfli amallar **yoziladi** (UI keyin).

**◻︎ Keyingi fazalar (to'liq back-office):**
- Faza 2: mahsulot moderatsiya, buyurtma majburiy bekor/refund, sklad nazorati, broadcast, audit UI.
- Faza 3: to'lovlar nazorati, provayder config, **moliya: payout tasdiq/release**, **komissiya sozlash**, reconciliation.
- Faza 4: impersonation, admin jamoa + granular permission, platforma sozlama/feature flag,
  kontent/banner, chuqur analitika, 2FA/IP allowlist.

---

## 9. Kelajakda alohida app'ga ajratish 💻

MVP'da admin = seller-cabinet ichida `ADMIN`-role bo'lim (kam ish, tez). Platforma o'sganda
alohida ilova (`apps/admin`, alohida domen/deploy) ga ajratiladi. **Buni arzon qilish uchun
hozirdan:**
1. Admin kodini **alohida feature/route papka**da saqlang (seller kodiga aralashmasin).
2. Umumiy UI/theme'ni **`packages/ui`** da (monorepo) — ikkalasi ulashsin.
3. API — role-based (`/admin/*` + RolesGuard) — allaqachon shunday.

Shunda ajratish = admin route'larni yangi app'ga ko'chirish + shared paket'ni qayta ishlatish,
deyarli qayta yozishsiz.

---

*Tirik hujjat. Manba: admin domeni → shu fayl; endpoint → `API_CONTRACT §8`; ekran → `DESIGN_TZ §11`; model/enum → `MARKETPLACE_PLAN §5/§6`.*
