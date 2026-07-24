# Elchi Marketplace — Dizayn TZ (Seller-Cabinet MVP)

> **Bu hujjat nima?** Sotuvchi kabineti (seller-cabinet) uchun **dizayn topshirig'i**. Uni
> dizayner ham, AI dizayn tool'lari (v0 / Lovable / Figma Make) ham to'g'ridan-to'g'ri
> ishlatishi mumkin. Poydevor (ranglar, shrift, komponent) + ekranlar birma-bir.
>
> **Bog'liq:** `TZ.md` (umumiy loyiha), `API_CONTRACT.md` (har ekranning ma'lumoti/amali).
> Ziddiyatda ma'lumot manbasi — `API_CONTRACT.md`, vizual manbasi — shu fayl.

Holat: **DRAFT** · 2026-07 · Qamrov: **Faza 1 — seller-cabinet** · Vibe: **Toza & ishonchli**

**Belgilar:** 👤 hamma/PM · 🎨 dizayner · 🤖 AI dizayn tool

---

## 0. Bir qarashda 👤

**Nima quramiz:** sotuvchi (do'kon egasi) uchun **boshqaruv paneli** (dashboard). Sotuvchi shu
yerda do'konini sozlaydi, mahsulot/variant/rasm qo'shadi, ko'p omborli skladini boshqaradi,
buyurtmalarini va yetkazish holatini kuzatadi.

**Kim ishlatadi:** sotuvchi (kompyuter/noutbukda, ba'zan planshet). Mobil — ikkilamchi.

**Xarakteri (vibe):** *Toza & ishonchli* — Uzum/Yandex Market kabi do'stona, yorqin, ishonch
uyg'otadigan. Ortiqcha bezak yo'q; ma'lumot va amal birinchi o'rinda.

**Texnik asos (o'zgarmaydi):** React 19 + **Ant Design (antd)** + Redux Toolkit + react-query.
Ya'ni dizayn antd komponentlari ustiga quriladi — biz antd'ni **theme token** orqali
"Elchi Market" ko'rinishiga moslaymiz, noldan komponent chizmaymiz.

---

## 1. Brend shaxsiyati va tamoyillar 👤🎨

**Shaxsiyat:** ishonchli · sodda · tezkor · zamonaviy. "Do'stona professional" — jiddiy, lekin
sovuq emas.

**Dizayn tamoyillari:**
1. **Ma'lumot — qahramon.** Har ekran bitta asosiy vazifaga xizmat qiladi; ortiqcha element yo'q.
2. **Bir marta qara — tushun.** Har jadval/karta bir qarashda o'qiladi (rang bilan holat, aniq yorliq).
3. **Xatoga o'rin qoldirma.** Har maydonda validatsiya, tasdiq (confirm), qaytarish (undo) imkoni.
4. **Har doim javob ber.** Har amalda loading/empty/error/success holati bor — foydalanuvchi hech qachon "nima bo'ldi?" demasin.
5. **Izchillik.** Bir xil narsa hamma joyda bir xil ko'rinadi (tugma, status rangi, spacing).

**Til/tovush:** o'zbekcha (lotin), sodda va iliq. Tugma matni fe'l bilan ("Saqlash", "Qo'shish",
"Faollashtirish"). Xato xabari ayblamaydi, yo'l ko'rsatadi ("Telefon +998 bilan boshlansin").

---

## 2. Design tokens (poydevor) 🎨🤖

### 2.1 Ranglar

**Asosiy (brand):**
| Token | Hex | Ishlatilishi |
|---|---|---|
| Primary | `#7C3AED` | Asosiy tugma, aktiv link, tanlangan menyu, urg'u |
| Primary hover | `#6D28D9` | Tugma hover |
| Primary active | `#5B21B6` | Tugma bosilganda |
| Primary bg (subtle) | `#F5F3FF` | Tanlangan qator foni, tag foni, aktiv menyu foni |

**Semantik (holat):**
| Token | Hex | Ma'no |
|---|---|---|
| Success | `#10B981` | Muvaffaqiyat, ACTIVE, yetkazildi |
| Warning | `#F59E0B` | Ogohlantirish, kam qoldiq, kutilmoqda |
| Error | `#EF4444` | Xato, rad etildi, o'chirish |
| Info | `#7C3AED` | Ma'lumot (primary bilan bir xil) |

**Neytral (kulrang shkala):**
| Token | Hex | Ishlatilishi |
|---|---|---|
| Text primary | `#1F2937` | Asosiy matn, sarlavha |
| Text secondary | `#6B7280` | Ikkilamchi matn, izoh |
| Text disabled | `#9CA3AF` | Nofaol |
| Border | `#E5E7EB` | Chegara, ajratgich |
| Bg subtle | `#F9FAFB` | Sahifa foni, jadval sarlavha foni |
| Bg base | `#FFFFFF` | Karta, panel foni |

> **Kontrast:** matn/fon kamida **WCAG AA** (4.5:1). Primary ustidagi oq matn — OK.

### 2.2 Tipografiya

- **Shrift:** `Inter` (asosiy UI). Sarlavhalar uchun ixtiyoriy `Manrope`. Fallback: system-ui.
- **Shkala:**

| Uslub | O'lcham / qator | Vazn | Qayerda |
|---|---|---|---|
| H1 | 28 / 36 | 700 | Sahifa sarlavhasi |
| H2 | 22 / 30 | 600 | Bo'lim sarlavhasi |
| H3 | 18 / 26 | 600 | Karta sarlavhasi |
| Body | 14 / 22 | 400 | Asosiy matn, jadval |
| Body-strong | 14 / 22 | 600 | Urg'u, summa |
| Small | 12 / 18 | 400 | Izoh, yorliq, badge |

### 2.3 Spacing va grid

- **Baza:** 4px shkala → `4, 8, 12, 16, 20, 24, 32, 40, 48`.
- **Sahifa padding:** 24px (desktop). **Karta ichi:** 20–24px. **Kartalar orasi:** 16–24px.
- **Grid:** 12 ustunli, gutter 24px. Kontent maksimal kengligi ~1200px, sidebar'dan keyin.

### 2.4 Radius, soya, chegara

| Token | Qiymat | Qayerda |
|---|---|---|
| Radius sm | 8px | Input, kichik tag |
| Radius base | 10px | Tugma, select |
| Radius lg | 14px | Karta, modal |
| Radius pill | 999px | Badge, avatar |
| Shadow sm | `0 1px 2px rgba(16,24,40,.06)` | Input, jadval qatori hover |
| Shadow md | `0 4px 12px rgba(16,24,40,.08)` | Karta, dropdown |
| Shadow lg | `0 12px 32px rgba(16,24,40,.12)` | Modal |

### 2.5 antd ThemeConfig (tayyor — copy-paste) 💻🤖

```ts
// theme.ts — <ConfigProvider theme={theme}> bilan ishlatiladi
import type { ThemeConfig } from 'antd';

export const theme: ThemeConfig = {
  token: {
    colorPrimary: '#7C3AED',
    colorSuccess: '#10B981',
    colorWarning: '#F59E0B',
    colorError: '#EF4444',
    colorInfo: '#7C3AED',
    colorTextBase: '#1F2937',
    colorBgBase: '#FFFFFF',
    colorBorder: '#E5E7EB',
    colorBgLayout: '#F9FAFB',
    borderRadius: 10,
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    fontSize: 14,
    controlHeight: 40,
    wireframe: false,
  },
  components: {
    Button: { controlHeight: 44, borderRadius: 10, fontWeight: 500, primaryShadow: 'none' },
    Input: { controlHeight: 44, borderRadius: 10 },
    Select: { controlHeight: 44, borderRadius: 10 },
    Card: { borderRadiusLG: 14, paddingLG: 24 },
    Table: { headerBg: '#F9FAFB', borderColor: '#F0F0F0', rowHoverBg: '#F5F3FF', cellPaddingBlock: 14 },
    Menu: { itemSelectedBg: '#F5F3FF', itemSelectedColor: '#7C3AED', itemBorderRadius: 10 },
    Tag: { borderRadiusSM: 8 },
    Modal: { borderRadiusLG: 14 },
  },
};
```

---

## 3. Komponentlar va holatlar 🎨🤖

> antd komponentlari + Elchi theme. Har komponentda **holatlar** majburiy.

**Tugma (Button):**
- `Primary` (binafsha, oq matn) — asosiy amal (Saqlash, Qo'shish). Ekranda bitta bo'ladi.
- `Default` (chegarali, oq fon) — ikkilamchi (Bekor).
- `Text/Link` (binafsha matn) — uchlamchi (Tahrir, Batafsil).
- `Danger` (qizil) — o'chirish/rad. Har doim **tasdiq (confirm) modal** bilan.
- Holatlar: default · hover · active · **loading** (spinner + nofaol) · disabled.

**Input/Select/Form:** label ustda, placeholder ichda, xatoda qizil chegara + ost matn.
Majburiy maydonda `*`. Forma yuborilganda tugma `loading`.

**Jadval (Table):** zebra yo'q, hover'da yengil binafsha fon; sarlavha `Bg subtle`; o'ng
ustunda amallar (ikonka). **Pagination** har doim (default 20/sahifa). Saralash — sarlavhadan.

**Status badge (Tag):** yumaloq, rangli — §6 jadvaliga qarang.

**Karta (Card):** oq fon, radius 14, soft shadow, sarlavha + kontent. Statistika kartalari
dashboard'da.

**Modal:** o'chirish/tasdiq uchun; sarlavha + matn + [Bekor][Tasdiq]. Radius 14, lg shadow.

**Media upload:** drag-and-drop maydon + preview grid; birinchi rasm = cover; `jpeg/png/webp`,
≤ 5 MB (aks holda xato toast).

**Toast/xabar (message/notification):** o'ng-yuqorida; success (yashil ✓), error (qizil ✕),
warning (sariq ⚠). 3–4 soniya.

### Universal holatlar (har ro'yxat/sahifada majburiy)
| Holat | Ko'rinishi |
|---|---|
| **Loading** | Skeleton (jadval/karta shakli), spinner emas iloji boricha |
| **Empty** | Illyustratsiya + matn + asosiy amal ("Hali mahsulot yo'q — [+ Yangi mahsulot]") |
| **Error** | Do'stona matn + "Qayta urinish" tugmasi |
| **Success** | Toast (yashil) yoki inline ✓ |
| **No permission** | "Bu bo'lim tasdiqdan keyin ochiladi" (pending holat, §5.3) |

---

## 4. Layout va navigatsiya 🎨🤖

**App shell:** chapda sidebar (kollaps bo'ladi) + tepada header + o'ngda kontent.

```
┌──────────┬────────────────────────────────────────────────┐
│ SIDEBAR  │  HEADER: [☰] Do'kon nomi ······· [🔔] [Avatar▾] │
│ (240px)  ├────────────────────────────────────────────────┤
│          │                                                │
│ 📊 Bosh  │   KONTENT (maks ~1200px, padding 24)           │
│ 🏪 Do'kon│                                                │
│ 📦 Mahsu.│                                                │
│ 🏬 Ombor │                                                │
│ 📋 Buyur.│                                                │
│ ⚙ Sozla. │                                                │
└──────────┴────────────────────────────────────────────────┘
```

**Sidebar menyu (= ekranlar ro'yxati):**
1. 📊 Bosh sahifa (Dashboard)
2. 🏪 Do'kon profili
3. 📦 Mahsulotlar
4. 🏬 Sklad (Omborlar + Qoldiq)
5. 📋 Buyurtmalar
6. ⚙ Sozlamalar (profil/parol/chiqish)

**Header:** do'kon nomi + logo, bildirishnoma (🔔), avatar dropdown (Profil / Chiqish).
Tasdiq kutilayotgan do'konda tepada sariq banner (§5.3).

**Responsive:** desktop-first (≥1024px to'liq). Planshetda (≥768) sidebar kollaps.
Mobil — faqat o'qish/ko'rish darajasi (MVP'da to'liq optimallashtirilmaydi).

---

## 5. Ekranlar (birma-bir) 🎨🤖

> Har ekran: **maqsad · layout (wireframe) · ma'lumot · amallar · holatlar · API**.
> Wireframe — joylashuv g'oyasi (piksel emas). Ma'lumot maydonlari `API_CONTRACT.md` bilan mos.

### 5.1 Kirish (Login) — public

**Maqsad:** telefon + parol bilan kirish.
```
              ┌────────────────────────────┐
              │        Elchi Market        │
              │     Sotuvchi kabineti      │
              │                            │
              │  Telefon [+998__________]  │
              │  Parol   [__________ 👁]   │
              │                            │
              │  [        Kirish        ]  │
              │                            │
              │  Hisob yo'qmi? Ro'yxatdan  │
              │  o'tish →                  │
              └────────────────────────────┘
```
- **Amal:** Kirish (loading). Xato → "Telefon yoki parol noto'g'ri" (bir xil xabar, §API_CONTRACT 2.4).
- **API:** `POST /auth/login`.

### 5.2 Ro'yxatdan o'tish (Register) — public

**Maqsad:** sotuvchi + do'kon ochish.
- **Maydonlar:** Ism*, Telefon* (+998), Parol* (min 8, ≥1 harf+1 raqam, kuch ko'rsatkichi),
  Do'kon nomi*, Region* (select).
- **Amal:** "Ro'yxatdan o'tish" → muvaffaqiyatda 5.3'ga (pending) o'tadi.
- **Holat:** telefon band → maydon ostda qizil "Bu telefon ro'yxatdan o'tgan".
- **API:** `POST /auth/register` (201: user PENDING + shop PENDING).

### 5.3 "Tasdiq kutilmoqda" (Pending) holati

**Maqsad:** do'kon `PENDING` bo'lganda nima bo'layotganini tushuntirish.
```
   ⏳  Do'koningiz ko'rib chiqilmoqda
   Admin tasdiqlagach, mahsulot qo'shishingiz mumkin bo'ladi.
   Odatda 1 ish kuni ichida. Xabar beramiz.
   [ Do'kon profilini to'ldirish ]   ← ruxsat berilgan yagona amal
```
- Sidebar'dagi qolgan bo'limlar nofaol (qulf ikoncasi), header'da sariq banner.
- Tasdiqlangach (WebSocket yoki qayta login) — to'liq kabinet ochiladi.

### 5.4 Bosh sahifa (Dashboard)

**Maqsad:** do'kon ahvoli bir qarashda.
```
Xush kelibsiz, Akmal Store 👋
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│Buyurtma│ │Daromad │ │Yo'lda  │ │Kam qol.│
│  42    │ │5.4 mln │ │  3     │ │  5 ⚠   │
└────────┘ └────────┘ └────────┘ └────────┘
┌─ Sotuv (7 kun) ──────────────────────────┐
│        ▂ ▃ ▅ ▂ ▇ ▅ ▃                      │
└──────────────────────────────────────────┘
┌─ Top mahsulotlar ──────┐ ┌─ Kam qolganlar ────────┐
│ 1. Adidas ...  21 dona │ │ Adidas/43   4 ⚠        │
│ 2. Nike ...    18 dona │ │ Nike/M      2 ⚠        │
└────────────────────────┘ └────────────────────────┘
```
- **Kartalar:** buyurtma soni, daromad (so'm), yo'ldagi posilka, kam qoldiq soni.
- **Holat:** yangi do'kon → nol/bo'sh (xato emas), "Birinchi mahsulotni qo'shing" chaqiruvi.
- **API:** `GET /seller/dashboard`.

### 5.5 Do'kon profili

**Maqsad:** do'kon ma'lumotini tahrirlash.
- **Maydonlar:** Nom, Tavsif, Telefon, Logotip (upload), Banner (upload), Region/Tuman, Manzil.
- **Faqat o'qish (server boshqaradi):** slug, holat, reyting, Elchi market id — kulrang, tahrirlanmaydi.
- **Amal:** "Saqlash" (loading → success toast).
- **API:** `GET/PATCH /sellers/me`.

### 5.6 Mahsulotlar ro'yxati

**Maqsad:** o'z mahsulotlarini ko'rish/boshqarish.
```
Mahsulotlar                                    [+ Yangi mahsulot]
[🔍 Qidiruv] [Holat ▾] [Kategoriya ▾]
┌────┬──────────────┬─────────┬────────┬──────────┬───────┐
│rasm│ Nom          │ Narx    │ Variant│ Holat    │  ⋯    │
├────┼──────────────┼─────────┼────────┼──────────┼───────┤
│ 🖼 │ Adidas kros. │149 000  │   2    │🟢 ACTIVE │ ✏  🗑 │
│ 🖼 │ Nike Air     │299 000  │   3    │⚪ DRAFT  │ ✏  🗑 │
│ 🖼 │ Puma ...     │199 000  │   1    │🔴 OUT    │ ✏  🗑 │
└────┴──────────────┴─────────┴────────┴──────────┴───────┘
                                        ← 1  2  3 ... 7 →
```
- **Filtr:** qidiruv, holat (ProductStatus), kategoriya, saralash (sana/narx/nom).
- **Amal:** Tahrir (✏), O'chirish (🗑 → confirm modal, soft-delete).
- **Empty:** "Hali mahsulot yo'q — [+ Yangi mahsulot]".
- **API:** `GET /products/my` (pagination).

### 5.7 Mahsulot qo'shish / tahrirlash (+ variant + rasm)

**Maqsad:** to'liq mahsulot yaratish. Eng murakkab ekran.
```
← Mahsulotlar / Yangi mahsulot
┌─ Asosiy ma'lumot ─────────────────────────────┐
│ Nom*       [_____________________________]    │
│ Kategoriya [Telefonlar ▾]                     │
│ Tavsif     [_____________________________]    │
│ Narx*      [499 000]   Eski narx [599 000]    │
├─ Rasmlar (birinchi = cover) ──────────────────┤
│ [ + ]  [🖼 ×]  [🖼 ×]  [🖼 ×]                  │
├─ Variantlar ──────────────────────────────────┤
│ ☑ Bu mahsulotning variantlari bor             │
│ ┌───────┬──────────┬────────┬──────┐          │
│ │ SKU   │ Nom      │ Narx   │  ⋯   │          │
│ │ADI-42 │ Qizil/42 │  —     │ ✏ 🗑 │          │
│ │ADI-43 │ Qora/43  │ 519000 │ ✏ 🗑 │          │
│ └───────┴──────────┴────────┴──────┘          │
│ [ + Variant qo'shish ]                        │
└───────────────────────────────────────────────┘
     [ Bekor ]  [ Qoralama saqlash ]  [ Faollashtirish ]
```
- **Validatsiya:** Nom 1–255, Narx > 0, SKU noyob (takror → xato), kategoriya mavjud.
- **Rasm:** drag-drop/tanlash, preview, tartib o'zgartirish, ≤ 5 MB.
- **Variant:** "variantlari bor" belgilansa jadval; variantsizda server default variant yaratadi.
- **Amal:** DRAFT saqlash yoki ACTIVE qilish; xatoda tegishli maydon qizil.
- **API:** `POST/PATCH /products`, `.../variants`, `POST /files/upload`.

### 5.8 Omborlar (Warehouses)

**Maqsad:** ombor ro'yxati + yangi ombor.
- **Ro'yxat:** nom, region/tuman, manzil, default belgisi, faol/nofaol.
- **Yaratish (modal):** Nom*, Region*, Tuman, Manzil, ☑ Asosiy (default). Birinchi ombor avtomat default.
- **API:** `GET/POST /inventory/warehouses`.

### 5.9 Qoldiq (Stock) + kirim/tuzatish

**Maqsad:** ombordagi qoldiqni ko'rish va boshqarish.
```
Sklad / Qoldiq         [Ombor ▾]  [☑ Kam qolganlar]
[🔍]                              [ Kirim + ]  [ Tuzatish ]
┌──────────────┬───────┬────────┬───────┬───────┬───────┐
│ Mahsulot     │ SKU   │ Ombor  │ Qo'lda│ Band  │Mavjud │
├──────────────┼───────┼────────┼───────┼───────┼───────┤
│ Adidas / 42  │ADI-42 │ Asosiy │  50   │  3    │  47   │
│ Adidas / 43  │ADI-43 │ Asosiy │  4 ⚠  │  0    │   4   │
└──────────────┴───────┴────────┴───────┴───────┴───────┘
```
- **Ustunlar:** mahsulot/variant, SKU, ombor, qo'lda (on hand), band (reserved), mavjud (available).
  Kam qoldiq → sariq ⚠.
- **Kirim (modal):** variant, ombor, miqdor (>0), sabab, idempotency kalit (avtomat).
- **Tuzatish (modal):** delta (+/−), sabab. Natija manfiy bo'lsa → **xato** (422), holat o'zgarmaydi.
- **Muhim:** bu yerda faqat qo'lda `inbound`/`adjust`. `reserve/commit/release` — ichki (checkout), UI'da yo'q.
- **API:** `GET /inventory/stock`, `.../stock/low`, `POST .../inbound`, `.../adjust`.

### 5.10 Buyurtmalar (Seller orders)

**Maqsad:** o'z sub-buyurtmalari + Elchi yetkazish holati.
```
Buyurtmalar           [Holat ▾] [Sana ▾] [🔍]
┌────────┬──────────┬─────────┬─────────┬────────────┬───────┐
│ №      │ Xaridor  │ Summa   │ To'lov  │ Holat      │ Track │
├────────┼──────────┼─────────┼─────────┼────────────┼───────┤
│ #55-3  │ Dilnoza  │ 149 000 │ COD     │🚚 Yo'lda   │  🔗   │
│ #55-2  │ Aziz     │ 299 000 │ Online  │✅ Yetkazil.│  🔗   │
│ #55-1  │ Kamola   │ 199 000 │ COD     │🔴 Qaytdi   │  🔗   │
└────────┴──────────┴─────────┴─────────┴────────────┴───────┘
```
- **Ustunlar:** raqam, xaridor nomi, summa, COD/Online, holat (SalesOrderSellerStatus rangli),
  Elchi tracking havolasi.
- **Filtr:** holat, sana oralig'i, qidiruv. Buyurtmasiz → bo'sh (xato emas).
- **Detail:** qatorni ochsa — mahsulotlar, manzil, Elchi shipment id, tarix.
- **API:** `GET /seller/orders`.

---

## 6. Status → rang xaritasi 🎨🤖

> Har enum qiymatiga **doimiy** rang. Butun ilovada bir xil ishlatiladi (izchillik).

| Enum | Qiymat | Rang | Badge |
|---|---|---|---|
| **ShopStatus** | PENDING | Warning `#F59E0B` | 🟡 Kutilmoqda |
| | ACTIVE | Success `#10B981` | 🟢 Faol |
| | SUSPENDED | Neutral `#6B7280` | ⚪ To'xtatilgan |
| | REJECTED | Error `#EF4444` | 🔴 Rad etilgan |
| **ProductStatus** | DRAFT | Neutral `#6B7280` | ⚪ Qoralama |
| | ACTIVE | Success | 🟢 Faol |
| | OUT_OF_STOCK | Error | 🔴 Tugagan |
| | ARCHIVED | Neutral (och) | ⚪ Arxiv |
| **SalesOrderSellerStatus** | PENDING | Warning | 🟡 Kutilmoqda |
| | SHIPMENT_CREATED | Info `#7C3AED` | 🟣 Posilka ochildi |
| | ON_THE_ROAD | Info | 🚚 Yo'lda |
| | DELIVERED | Success | ✅ Yetkazildi |
| | CANCELLED | Neutral | ⚪ Bekor |
| | RETURNED | Error | 🔴 Qaytdi |

---

## 7. Formatlar va til 🎨🤖

| Tur | Format | Misol |
|---|---|---|
| Pul | probel bilan minglik + "so'm" | `149 000 so'm` |
| Katta pul | qisqartma (dashboard) | `5.4 mln so'm` |
| Telefon | `+998 XX XXX XX XX` | `+998 90 123 45 67` |
| Sana | `DD.MM.YYYY` | `21.07.2026` |
| Sana+vaqt | `DD.MM.YYYY HH:mm` | `21.07.2026 18:30` |
| Bo'sh qiymat | tire | `—` |

**Til:** interfeys o'zbekcha (lotin). Kelajakda i18n (ru/uz) — matnlar kalit orqali (hardcode emas).

---

## 8. Accessibility (qulaylik) 🎨

- Kontrast ≥ AA (4.5:1). Rang **yolg'iz** ma'no tashimasin — status'da rang **+** matn/ikonka.
- Har interaktiv element klaviaturadan yetiladi (focus ko'rinadi — binafsha halqa).
- Form label bilan bog'langan; xato matni maydonga bog'liq (aria).
- Bosiladigan joy ≥ 40×40px.

---

## 9. AI dizayn tool'da qanday ishlatish 👤🤖

Bu hujjatdan ekran generatsiya qilish uchun (v0.dev / Lovable / bolt.new / Figma Make):

1. **Poydevorni ber:** §2 (tokenlar) + §2.5 (antd theme) + §1 (vibe) ni promptga joyla.
2. **Bitta ekran so'ra** (hammasini emas): §5'dagi bitta ekranni (wireframe + maydon + holat) copy qil.
3. **Stack'ni ayt:** "React + Ant Design (antd), quyidagi theme token bilan".

**Tayyor prompt namunasi (5.6 Mahsulotlar ro'yxati uchun):**
```
React + Ant Design (antd) bilan "Mahsulotlar ro'yxati" ekranini yasab ber.
Theme: primary #7C3AED, success #10B981, font Inter, radius 10px, toza & ishonchli marketplace uslubi.
Layout: chapda sidebar (Bosh/Do'kon/Mahsulotlar/Sklad/Buyurtmalar), tepadan header (do'kon nomi + avatar).
Kontent: sarlavha "Mahsulotlar" + o'ngda [+ Yangi mahsulot] tugma; tepada qidiruv, holat filtri, kategoriya filtri.
antd Table ustunlari: rasm (thumbnail), nom, narx (149 000 so'm), variant soni, holat (rangli Tag: ACTIVE=yashil, DRAFT=kulrang, OUT_OF_STOCK=qizil), amallar (tahrir/o'chirish ikonka).
Pagination 20/sahifa. Empty holat: "Hali mahsulot yo'q" + [+ Yangi mahsulot].
Barcha matn o'zbek tilida (lotin). Faqat frontend, mock data bilan.
```

---

## 10. Yetkazib berish (deliverables) 👤🎨

MVP dizayn tayyor deb hisoblanishi uchun:
1. ✅ Design tokenlar tasdiqlangan (§2) + antd theme fayli (`theme.ts`).
2. ✅ §5'dagi **10 ekran** — Figma'da yoki to'g'ridan kod (React+antd) sifatida.
3. ✅ Har ekranda loading / empty / error holati.
4. ✅ Status ranglari (§6) izchil.
5. ✅ Lead + jamoa ko'rib tasdiqlagan.

> **Eslatma:** seller-cabinet antd asosida — ko'p vizual qaror antd + theme token bilan
> hal bo'ladi. Shuning uchun asosiy qiymat **ekranlar ro'yxati + holatlar + izchillik**da,
> piksel-perfect bezakda emas. Storefront (xaridor, Faza 2) uchun alohida, estetikaga
> ko'proq urg'u beradigan Design TZ keyin yoziladi.

---

## 11. Admin bo'lim ekranlari 🎨🤖

> Admin **shu cabinet ilovasi ichida** `ADMIN`/`SUPERADMIN` rol bilan ochiladi — **bir xil
> design token/komponent** (§2–§4), faqat urg'u boshqacha. Domen tafsiloti: `ADMIN_TZ.md`.
> Belgilar: ⭐ MVP · ◻︎ keyin.

**Farqlash belgisi:** admin bo'limida sidebar tepasida **"ADMIN"** yorlig'i + boshqacha aksent
(masalan Info binafsha yoki to'q kulrang header) — foydalanuvchi seller vs admin rejimini
adashtirmasin.

**Admin sidebar (= ekranlar):**
1. 📊 Dashboard ⭐ · 2. 👥 Accountlar ⭐ · 3. 🏪 Do'konlar ⭐ · 4. 📋 Buyurtmalar ⭐ ·
5. 🗂 Kategoriyalar ⭐ · 6. 📦 Mahsulot moderatsiya ◻︎ · 7. 💰 Moliya (payout/komissiya) ◻︎ ·
8. 💳 To'lovlar ◻︎ · 9. 🚚 Integratsiya ◻︎ · 10. 📣 Broadcast ◻︎ · 11. ⚙ Sozlamalar ◻︎ ·
12. 🛡 Admin jamoa ◻︎ · 13. 📜 Audit log ◻︎.

### 11.1 Admin dashboard ⭐
```
Platforma umumiy holati
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│Do'kon  │ │Sotuvchi│ │Buyurtma│ │ GMV    │ │Daromad │
│120 (4⏳)│ │  118   │ │ 5 200  │ │840 mln │ │42 mln  │
└────────┘ └────────┘ └────────┘ └────────┘ └────────┘
┌─ Tasdiq kutayotgan do'konlar (4) ────────────────────┐
│ Akmal Store · Nike UZ · ...        [Ko'rish →]        │
└──────────────────────────────────────────────────────┘
```

### 11.2 Accountlar ⭐
- Jadval: ism, telefon, rol (Tag), holat (faol/bloklangan), ro'yxat sanasi, amallar.
- Filtr: rol, holat, qidiruv. Amal: ko'rish · **Bloklash/Faollashtirish** (confirm) · (◻︎ rol/parol).
- **API:** `GET /admin/users`, `POST .../block|unblock`.

### 11.3 Do'konlar ⭐ (eng muhim)
```
Do'konlar         [Holat ▾: PENDING] [🔍]
┌──────────────┬──────────┬─────────┬──────────┬──────────────────┐
│ Do'kon       │ Egasi    │ Region  │ Holat    │ Amal             │
├──────────────┼──────────┼─────────┼──────────┼──────────────────┤
│ Akmal Store  │ A.Karimov│ Toshkent│🟡Kutilmoq│ [Ko'rish][✓][✕]  │
└──────────────┴──────────┴─────────┴──────────┴──────────────────┘
```
- **Detail:** do'kon profili + mahsulot/buyurtma/ombor sanoqlari + **[Tasdiqlash][Rad etish][To'xtatish]**.
- **Tasdiqlash** → confirm modal ("Elchi'da akkaunt ochiladi") → success/xato (Elchi rollback).
- **API:** `GET /admin/shops`, `.../:id`, `POST .../approve|reject|suspend|activate`.

### 11.4 Buyurtmalar (hamma) ⭐
- Jadval: №, do'kon(lar), xaridor, summa, to'lov, holat, sana. Filtr: holat/to'lov/do'kon/sana.
- **Detail:** sub-buyurtmalar + itemlar + shipment + to'lov + tarix (read-only ⭐; bekor/refund ◻︎).
- **API:** `GET /admin/orders`, `.../:id`.

### 11.5 Kategoriyalar ⭐
- Daraxt ko'rinishi + qo'shish/tahrir/o'chirish (drag tartib ◻︎), ikonka, faol/nofaol.
- **API:** `GET/POST/PATCH/DELETE /admin/categories`.

### 11.6 Moliya / Payout / Komissiya ◻︎ (SUPERADMIN)
- Payout jadvali (do'kon, summa, holat) + **[Tasdiq][Ushlash][Release]** (confirm).
- Komissiya: global/kategoriya/do'kon stavka (percent/fixed) formasi. Daromad hisoboti.
- **API:** `GET /admin/finance/*`, `POST .../payouts/:id/approve|hold|release`.

### 11.7 Boshqalar ◻︎
To'lovlar · Integratsiya (shipment/webhook log) · Broadcast (audience+kanal+matn) · Sozlamalar ·
Admin jamoa (rol) · Audit log (filtr/qidiruv) — hammasi bir xil token/komponent, `ADMIN_TZ.md §3` bo'yicha.

---

*Tirik hujjat — dizayn/qaror o'zgarsa yangilanadi. Manba: vizual → shu fayl, ma'lumot → `API_CONTRACT.md`, admin domeni → `ADMIN_TZ.md`.*
