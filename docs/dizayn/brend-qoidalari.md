# Elchi brend qoidalari

Yakuniy E uslubining rang, shrift va komponent asosi: tasdiqlangan Elchi CRM dizayni v2 (A varianti) qoidalari va logotip tavsifi. Bu to‘liq brif emas, undan faqat dizayn qoidalari ko‘chirilgan. E uchun qaysi qism qayerdan olingani: [`final-brief.md`](final-brief.md).

`[taklif]` belgisi egasi hali tasdiqlamagan takliflarni bildiradi.

---

### 1.1 Colour tokens (light is the default theme)

Source: `5E-TECH/Elchi-Frontend`, `src/index.css` @theme.

| Token | Light | Use |
|---|---|---|
| `bg` | `#f4f6fb` | Page canvas. Content sits on it directly, not inside a card. |
| `surface` | `#ffffff` | Cards, panels, tables, top bar, bottom nav. |
| `raised` | `#ffffff` | Dialogs, dropdowns, popovers, toasts. |
| `sunken` | `#f0f3f9` | Table header row, segmented-control track, chips, skeletons, inset blocks. |
| `input` | `#ffffff` | Fields. |
| `row-hover` | `#f7f9fd` | Table and list row hover. |
| `border` | `#e1e6f0` | All 1 px dividers, card borders and row lines. |
| `border-strong` | `#c9d1e0` | Field, secondary-button and chip borders. |
| `text` | `#101733` | Primary text. |
| `text-muted` | `#4b5575` | Secondary text (AA ≥ 4.5:1). |
| `text-subtle` | `#7c859f` | Placeholders and axis labels only, at 12 px or larger. |
| `brand` | `#1f2853` | Logo and brand emphasis. |
| `nav` | `#1f2853` | Sidebar background. |
| `nav-accent` | `#8ea6ff` | Accent on navy only, such as the scanner frame and the error-page icon. Never used on white. |
| `nav-text` / `nav-muted` | `rgba(255,255,255,.80)` / `.52` | Sidebar item text and icons / sidebar group labels. |
| `nav-hover` / `nav-active` / `nav-line` / `nav-count` | white at 8 % / 14 % / 10 % / 14 % | Sidebar hover / active item / line under the logo / count pill. |
| `on-nav` | `#ffffff` | Text of the active or hovered sidebar item. |
| `avatar` / `on-avatar` | `#1f2853` / `#ffffff` | Initials circle. |
| `action` | `#2b50d8` | Primary button, selected states, links. **Blue is only for interactive things.** |
| `action-hover` | `#2443b8` | Hover. |
| `action-fg` | `#2b50d8` | Link text and active-tab text. |
| `action-soft` | `#e8edfd` | Selected row, active chip, active tab count. |
| `on-solid` | `#ffffff` | Text on a solid `action` or status fill. |
| `focus` | `rgba(43,80,216,.28)` | 3 px field focus ring. |
| `success` / `-fg` / `-soft` | `#12704f` / `#12704f` / `#e3f4ec` | Sold, paid, active. |
| `warning` / `-fg` / `-soft` | `#95560a` / `#95560a` / `#fcf0dc` | In progress, waiting. |
| `danger` / `-fg` / `-soft` | `#be2a3b` / `#be2a3b` / `#fde8ea` | Cancelled, error, debt. |
| `info` / `-fg` / `-soft` | `#1a62a8` / `#1a62a8` / `#e2effa` | New, created, received. |
| `overlay` | `rgba(16,23,51,.45)` | Modal backdrop, no blur. |
| `chart-1…8` | `#2b50d8` `#eb6834` `#1baf7a` `#eda100` `#e87ba4` `#008300` `#4a3aa7` `#e34948` | Categorical series. The order is fixed. |
| `chart-muted` | `#c9d1e0` | The «Boshqa» series and tracks. |
| Map / heat scale | `#cde2fb` → `#86b6ef` → `#3987e5` → `#1c5cab` | One sequential blue scale. |

Shadows (mock kit):

- `shadow-1` is `0 1px 2px rgba(16,23,51,.06)`. It is used only on the selected segment.
- `shadow-2` is `0 16px 40px rgba(16,23,51,.16), 0 2px 6px rgba(16,23,51,.06)`. It is used only on floating layers:
  dialog, menu, popover, date panel, toast and the scanner FAB.
- **Cards have no shadow.** They use a 1 px `border` instead.

Note: `chart-7` `#4a3aa7` is a validated chart colour. The "no purple" rule (§2.3) applies to brand and UI chrome, not
to this series slot.

### 1.2 Dark theme (a note only)

Light is the default. Dark appears only when the user picks it, and every v2 screen is drawn in both.

Dark values:

- **Surfaces:** `bg #0d1120`, `surface #151a2e`, `raised #1c2240`, `sunken/input #11162a`, `row-hover #1a2036`.
- **Borders:** `border #262d4a`, `border-strong #3a4366`.
- **Text:** `text #e8ebf7`, `muted #a7afcb`, `subtle #7a83a3`, `brand #c9d2f5`.
- **Navigation:** `nav #0a0e1b`.
- **Action:** `action #8ea6ff`, hover `#a9bbff`. **Text on a blue fill is dark (`on-solid #0d1120`).**
- **Status:** `#4fc58e` / `#f1b24e` / `#ff7182` / `#6bb6f3`. The soft variants are the same colours at 14 % alpha.
- **Overlay and avatar:** `overlay rgba(3,5,12,.62)`, `avatar #2b3768`.
- **Charts:** `#5b7cf0 #d95926 #199e70 #c98500 #d55181 #008300 #9085e9 #e66767`.

### 1.3 Typography

- **Family:** Manrope only. The stack is `"Manrope", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`. The kit loads 400, 500, 600 and 700 from Google Fonts. The app requests the variable range
  400..800.
- **Weights:** only **400, 500, 600 and 700**. Weights 800 and 900 are blocked by the `weight` guard.
  - DS §1 still says "KPI raqamlari 800 gacha". The guard and the code override it: KPI values use 700.
- **Base size:** the root is 14 px with line height 1.5.
- **Numerals:**
  - Tables (`td`, `th`) use tabular figures.
  - Big standalone numbers (KPI, gauge) use proportional figures.
- **Minimum size:** no text is smaller than 12 px.
- **Inputs on phones:** 16 px, because iOS zooms into smaller fields.

| Role | Size / line height | Weight | Tracking |
|---|---|---|---|
| Gauge value | 40/44 (phone 36) | 700 | −0.02em |
| KPI value | 28/36 (phone 22/30) + unit 14/600 muted | 700 | −0.01em |
| Amount in a confirm dialog | 28/36 + currency 14 muted | 700 | — |
| Page title (h1) | 24/32 (phone 20/28) | 700 | −0.01em |
| Mobile top-bar title | 17 | 700 | — |
| Section / card title (h2) | 16/24 | 700 | — |
| Dialog title, empty-state title | 16 | 700 | — |
| Large button | 15 | 600 | — |
| Small card title (h3) | 14/20 | 600 | — |
| Body, table cell, nav item, button md, tab | 14 (paragraph line 21) | 400–500; buttons and tabs 600; nav 500, active 600 | — |
| Small: field label, KPI label, description, sub-cell, segment, chip, small button, page number | 13 (description 13/18) | labels 600, text 400–500 | — |
| XS: badge, hint, error text, meta, tooltip, bottom-nav label | 12 (meta 12/18) | badge 600; hint 400; error 600 | — |
| Overline / table header / sidebar group | 12, uppercase | 600 | +0.05em / +0.04em / +0.06em |

### 1.4 Spacing, radii, lines, focus, motion

- **Spacing scale:** 4 · 8 · 12 · 16 · 20 · 24 · 32.
  - Gap between page blocks: 24, or 16 on a phone.
  - Card padding: 20.
  - Grid gaps: 16, or 12 on a phone.
- **Radii:**

  | Element | Radius |
  |---|---|
  | Badge | 6 |
  | Small button, menu item, tooltip | 8 |
  | Button, field, icon button, nav item, KPI icon box | 10 |
  | Large button, menu, alert, toast, inset block | 12 |
  | **Card**, popover, date panel | **14** |
  | Dialog | 20 (16–20) |
  | Phone sheet | 20 on the top corners only |
  | Pill (chips, counts) | 999 |

- **Lines:** a 1 px `border` for card edges, dividers and row lines. A 1 px `border-strong` for fields, secondary
  buttons and chips. A 2 px `action` underline marks the active tab.
- **Nesting:** cards nest **at most 2 levels deep**. An inner section uses a divider line or a `sunken` block with radius 12
  and no border.
- **Focus:**
  - Global: a 2 px `action` outline, offset 2.
  - Fields: an `action` border plus a 3 px ring in `focus`.
- **Motion and loading:**
  - Colour transitions take 150 ms.
  - Navigation: a 3 px `action` bar appears at the top after 150 ms. There is no full-screen loader.
  - Data: a skeleton appears after 400 ms, and a "slow" hint after 15 s.
  - All of it respects `prefers-reduced-motion`.

### 1.5 Component sizes

| Component | Size and look |
|---|---|
| **Button** | Heights: sm 32 / md **40** / lg 48, phone min 44. Radii 8 / 10 / 12. Padding 12 / 16 / 20, gap 8. Text 13 / 14 / 15 at weight 600. Icon 16 / 18 / 18, one icon per button, placed left; "compact" uses px 12, gap 6, icon 16. Disabled is 45 % opacity. |
| Button variants | **primary**: `action` fill with white text. **secondary**: white with a `border-strong` border. **ghost**: transparent with muted text. **link**: `action-fg` text, underline on hover. **success**: green fill. **danger**: red fill, only inside confirm dialogs. **danger-soft** / **success-soft**: soft fill with fg text. |
| Icon button | 32 / 40 / 44, radii 8 / 10 / 12, icons 16 / 20 / 22, ghost by default. An `aria-label` is required. |
| **Field** | Label 13/600 above the control, gap 6. A required `*` uses `danger-fg`. The hint is 12 muted. An error is 12/600 `danger-fg` with a `CircleX` icon and replaces the hint, so the height does not jump. |
| **Input / select / date** | Height **40** (lg 48 with radius 12 and 15 px text), radius 10, padding 12. Text 14 (16 on phone) on a white fill with a `border-strong` border. Hover darkens the border; focus adds the `action` border plus a ring; invalid uses a `danger` border; disabled or read-only uses a `sunken` fill. Search has a left icon at 18 and text starting at 40. Units such as «so‘m», «kg» and «sm» sit as muted text inside, on the right. |
| Select as a filter | Empty shows «Barchasi». With a value, the chevron becomes a × «Tozalash» (owner, 2026-10-16). |
| Textarea | Min height 88, vertical padding 10. |
| Checkbox / radio | 18 px, `action` accent. |
| Switch | 36 × 20 pill. Off is `border-strong`; on is `action`. |
| **Chip** (filter) | 32 tall (44 on phone), pill, padding 12, 13/500, white fill with a `border-strong` border. Active: `action` border, `action-soft` fill and 600 `action-fg` text, plus a 20 px ×. |
| Segmented control | 40 high: a `sunken` track with 3 px padding and a 1 px border holds 32 px options. Radii 10 / 8. Text 13/600, muted. The selected option is white with `shadow-1`. The «Grafik» / «Jadval» toggle uses the same control with 16 px icons. |
| **Tabs** | 44 tall (48 on phone), padding 12, 14/600, muted. The active tab has `text` colour and a 2 px `action` underline on a 1 px `border` baseline. The count pill is 20 tall, min width 22, `sunken`/muted; it turns `action-soft`/`action-fg` on the active tab. |
| **Badge** | 24 tall (sm 20), radius 6, padding 8, 12/600, soft tone fill with fg text, a **6 px dot** and no icon. Variants: outline (1 px ring in the current colour) and solid (tone fill with `on-solid` text). |
| **Table** | Header **40**, `sunken`, 12/600 uppercase at +0.04em, muted, padding 16. Rows **56**, padding 16, `border` bottom line, hover `row-hover`, selected `action-soft`. Money and numbers are right-aligned. Compact (chart twin): header 36, rows 44, padding 12. |
| Two-line cell | Title 14/600 `text`, sub-line 13 muted. Example: «№10242» with a copy icon above «Bugun, 14:40». |
| List item | Min height 56, padding 16/12, gap 12, `border` bottom line, hover `row-hover`. |
| Pagination | Summary «1–10 / 1 248 ta buyurtma» at 13 muted. Page-size select «10 ta», hidden on phone. Page buttons are 32 (44 on phone), radius 8, 13/600; the current page is an `action` fill with white text. Pattern `1 2 3 … 125`. |
| **Card** | Radius 14, 1 px `border`, white, no shadow. Head: padding 20/16 with a bottom line; title 16/700 (or 14/600); description 13/18 muted; actions on the right. Body: padding 20. Footer: padding 20/12 with a top line. |
| **KPI card** | Padding 20/16 (phone 16/14), gap 6. Label 13/600 muted. A neutral 36 px icon box (radius 10, `sunken`, icon 18, hidden on phone). Value 28/36/700 followed by the unit at 14/600 muted, for example «48,6» + «mln so‘m». Meta line 12 muted. The delta chip is 22 tall, radius 6, 12/700, green or red soft. An optional sparkline sits at the bottom. **Row:** 4 columns, 2 on tablet, gap 16 (12 on phone). |
| Key–value list | Columns 40 % / 60 %. `dt` is 14 muted; `dd` is 14/600. Row gap 10, column gap 16. |
| **Dialog** | Radius 20, padding 24, gap 16, `raised` fill, 1 px border, `shadow-2`. Widths 440 (confirm), 480 (default), 560 and 640. Header: a 36 px icon box (radius 10, tone soft), or a 40 px circle in confirm dialogs. Title 16/700, description 13 muted, close button sm. Footer: **always a top line** (owner, 2026-10-16), right-aligned, with «Bekor qilish» (secondary) and **one** primary. |
| Phone sheet | Every dialog becomes a bottom sheet on phone: max height 92 dvh, top radius 20, padding 16, a 40 × 4 grip inside a 32 px drag strip, safe-area padding at the bottom, and full-width buttons shared 50/50. |
| Confirm dialog (money, deactivation, «Kunni yakunlash») | `alertdialog` at 440. A `sunken` object card. The amount at 28/36/700. «Qayerdan → Qayerga» with `ArrowRight`. A consequences list. The button carries an exact verb («Tasdiqlash», «Nofaol qilish»), never «OK» or «Ha». A destructive action uses the danger tone. |
| Menu | Min width 200, padding 6, radius 12, `shadow-2`. Items 36 (44 on phone), radius 8, padding 10, gap 10, 14 px, muted icons. A danger item uses `danger-fg`. |
| Tooltip / popover | Tooltip: inverted colours (`text` fill, `bg` text), radius 8, padding 10/6, 12/600, max width 240. Popover: width 320, padding 16, radius 14. |
| Toast | Radius 12, padding 16/12, 14 px, `raised` fill, border, `shadow-2`, a 20 px icon in the tone colour, neutral text. Placement: bottom-right at 24 px, at most 3; on phone, under the top bar, one at a time. Duration: 4 s, or 6 s for warnings and toasts with an action; errors stay until closed. Title 2–4 words. |
| Inline alert | Radius 12, padding 16/12, 14 px, soft tone fill with fg text, bold title. The neutral version is `sunken` with a `border` ring. |
| Empty state | Centred, padding 24/48, gap 8. A 48 px `sunken` circle with a 24 px lucide icon (never an emoji). Title 16/700. Text 14 muted, max width 380. One action. It says why the view is empty and what to do next. |
| Skeleton / spinner | Skeleton: `sunken` blocks (12 px lines with radius 6, blocks with radius 10), pulsing. The table skeleton keeps the 40 px header and 56 px rows. Spinner: 16 px with a 2 px border (lg 32 / 3 px), 0.7 s. |

### 1.6 Shell and navigation

- **Canvas.** The page canvas is `bg`. Content is **not** wrapped in a card. It has a max width of 1440 and is centred.
  - At 1024 px and wider: padding is 24 top, 32 sides, 48 bottom.
  - Below 1024 px: padding is 16 top, 16 sides, 88 bottom (room for the bottom nav).
  - Scrolling happens only in `<main>`.
- **Sidebar** (1024 px and wider). It is 248 px wide (72 when collapsed), `nav` navy in both themes, with padding 12.
  - **Logo row:** 64 tall, a 1 px `nav-line` underneath, the white «ELCHI POCHTA» lockup at 32 px height. The
    collapsed sidebar shows the mark only.
  - **Groups:** only on long menus, using the CRM groups Ish · Moliya · Ma’lumotnoma · Tizim. Group labels are 12/600
    uppercase at +0.06em in `nav-muted`, with padding 16 top and 6 bottom, and collapse with a 16 px chevron.
  - **Item:** 40 tall, radius 10, padding 12, gap 12, a 20 px icon, 14/500 in `nav-text`. Hover uses `nav-hover`
    with white text. **Active uses a `nav-active` fill (white at 14 %) with white 600 text.** There is no coloured
    side bar and no blue fill.
  - **Count pill:** 20 tall, min width 22, `nav-count` fill, 12/600 white, for example «Qabul va yaratish 7».
  - **Footer:** «Yashirish» with `PanelLeft`, above a line.
- **Top bar.** 64 tall, white, with a bottom line and padding 32 (16 below 1024). Layout by width:
  - **1024 and wider:** global search on the left (420 wide, 40 tall, `Search` icon, placeholder «Ism, telefon yoki
    buyurtma raqami», Ctrl K) → spacer → «Skanerlash» (secondary, `ScanLine`, scanner roles only) → bell icon button
    with a red count badge → user button (32 px navy avatar with 13/700 white initials, name 14/600, role 12 muted,
    `ChevronDown` 16).
  - **768–1023:** `[menu] … [Skanerlash] [search] [bell] [avatar]`.
  - **Below 768:** `[menu] … [search] [bell] [avatar]`.
- **Page header.** Left-aligned. An optional back link («← Mahsulotlar», 14 muted) sits above the h1, and an
  optional description or meta line sits below it (14 muted, for example «Jami 1 248 ta buyurtma · Oxirgi
  yangilanish: 14:42 · ● Avtomatik yangilanadi»). Actions are right-aligned to the bottom of the title block, with
  secondaries left of **the one primary**. On a phone the actions go full width and share the row.
- **Tablet (768–1023).** A menu button opens a navy drawer, `min(296px, 86%)` wide, with an overlay. Secondary table
  columns are hidden.
- **Phone (below 768).**
  - **Bottom nav:** 64 tall plus the safe area, white, with a top line and 5 equal cells. Each cell has a 22 px icon
    and a 12/600 one-line label. **The active cell changes only colour (`action-fg`)**; there is no pill.
  - **Scanner FAB:** for scanner roles the centre cell is a 52 px `action` circle raised 28 px, with a 4 px white ring,
    `shadow-2` and a 24 px `ScanLine` icon.
  - **«Menyu»** opens a bottom sheet with 3-column tiles, 72 tall, radius 12, `sunken`. The active tile is
    `action-soft`.
  - **Content changes:** tables become cards, 3 or more filters move behind a «Filtrlar N» button and a sheet, dialogs
    become sheets, and the main action is full width at the bottom.

### 1.8 Status → tone

v2 rule: a status colour is **never shown alone**. It always comes with a word (a badge) or an icon. Badges use a dot
and no icon.

| Tone | Fill / text | Meaning in v2 | v2 examples |
|---|---|---|---|
| info | `#e2effa` / `#1a62a8` | New, created, received | Yangi, Yaratilgan, Qabul qilindi |
| warning | `#fcf0dc` / `#95560a` | In progress, waiting | Yo‘lda, Kutilmoqda, Qisman to‘langan |
| success | `#e3f4ec` / `#12704f` | Sold, paid, active | Sotilgan, To‘langan, Faol |
| danger | `#fde8ea` / `#be2a3b` | Cancelled, error, debt | Bekor qilingan; «Bekor — jo‘natilgan» uses danger **outline** |
| neutral | `#f0f3f9` + `#e1e6f0` ring / `#4b5575` | Closed, inactive, type labels | Yopilgan, «Marketga topshirildi» (owner, 2026-10-19), Nofaol, Uygacha / Markazgacha |

More tone rules:

- **Notification states** (owner, 2026-10-19, «Ranglar ma’qul»):
  - queued or sending: yellow;
  - skipped or provider not connected: grey;
  - error: red;
  - delivered: green.
- **Money direction:**
  - The sign is part of the text, and only the amount text is coloured: income uses `success-fg`, outgoing and debt use
    `danger-fg`.
  - Finance icons and operation badges stay neutral.
- **Same state, same tone, everywhere.** For example, «Yo‘lda» uses the warning tone for a parcel and for an order
  alike.

Marketplace states (names from TZ) have **no approved tones**. Below is a **[taklif]** analogy only; the
owner must approve it.

| TZ state | v2 analogy | Tone [taklif] |
|---|---|---|
| Order: Tasdiqlandi | Yaratilgan / Qabul qilindi | info |
| Order: Yig‘ilmoqda, Qadoqlandi, Elchi’ga topshirildi, Yo‘lda | Jarayonda / Yo‘lda | warning |
| Order: Yetkazildi, Pul o‘tkazildi | Sotilgan / To‘langan | success |
| Order: Yopildi | Yopilgan | neutral |
| Order: Rad etildi, Qaytmoqda | «Bekor · yo‘lda» | danger |
| Order: Qaytib keldi | «Marketga topshirildi» (end of the chain) | neutral |
| Order: Bekor qilindi | Bekor qilingan | danger |
| Lead: Qayta qo‘ng‘iroq | Kutilmoqda | warning |
| Lead: Rad etildi | Bekor qilingan | danger |
| Lead: Yaroqsiz, Dublikat, Aloqa bo‘lmadi | Closed / inactive | neutral? (needs a decision) |

**Conflict:** the lead «Tasdiqlandi» is a success outcome, while the order «Tasdiqlandi» is the first order state (info).
That is one word with two tones.

### 1.9 Formats

| What | Uzbek output | Rule |
|---|---|---|
| Money | `185 000 so'm` | Whole so‘m. Thousands separated by a plain space (U+0020). The currency follows the amount. |
| Debt / negative | `−240 000 so'm` | A true minus sign (U+2212), never a hyphen. |
| Signed money | `+185 000 so'm` / `−240 000 so'm` | Zero has no sign. The colour comes from the caller. |
| Compact (KPI and charts only) | `48,6 mln so'm` · `185 ming so'm` · `1,2 mlrd so'm` | One decimal with a comma and no trailing `,0`. In a KPI, the value «48,6» and the unit «mln so‘m» are styled separately. |
| Chart axis | `1,05 mln` | Up to 2 decimals, no currency. |
| Number | `1 545 000` | |
| Percent | `8,2%` · `−6,2%` | Comma decimal, no space in Uzbek. |
| Phone | `+998 90 123 45 67` | 2-3-2-2 grouping. |
| Date / time | `08.10.2026` · `19:05` | 24-hour clock. |
| Date and time in lists | `Bugun, 14:15` · `Kecha, 18:04` · `06.10.2026, 19:05` | |
| Date range | `01.10 – 08.10.2026` | The year appears once when both dates share it. |
| Order number / count | `№10241` · `1 248 ta buyurtma` | |
| Empty value | `—` | |

**Apostrophe difference.** The CRM prints «so'm» with ASCII U+0027. That is the CRM code and its screenshots. For the
marketplace, the copy rule is ‘ (U+2018), so draw **«so‘m»**, «To‘langan» and «Qo‘shish». Manrope has both ‘ and ’
(verified).

### 1.10 Icons

- **Library:** only `lucide-react`. The registry holds **133 concepts in 12 groups** by my count of
  `icon-registry.json`; DS §10 says 132.
- **Drawing rules:** stroke **2**, round caps, a 24 × 24 viewBox and `currentColor`.
- **Sizes:** 16, 18, 20, 22 and 24 only, plus 14 inside badges and chips.
  - 16: small buttons and table marks.
  - 18: buttons, fields and menus.
  - 20: sidebar, top bar, KPI and alerts.
  - 22: bottom nav.
  - 24: empty states and dialog heads.
- **Banned:** emoji, filled icons and other libraries.
- **Meaning rules:**
  - One meaning, one icon.
  - A status icon takes the tone's fg colour. All other icons are neutral.
  - **Blue icons appear only on interactive elements.**
  - KPI icons are always neutral.
  - Status and delivery badges have no icon.
- **On text buttons:** a text button has one icon, on the left, and **gets no icon when the icon adds no meaning**.
  A plain «Saqlash» has no icon.
- **Canonical names** useful for the marketplace:
  - Navigation and actions: `House`, `ArrowLeft`, `ChevronDown` / `Right`, `Plus`, `Pencil`, `Trash2`, `Copy`,
    `X`, `Check`, `Send`, `Download`, `RefreshCw`, `Search`, `Ellipsis`, `ImagePlus`, `ExternalLink`.
  - Status: `CircleCheck`, `TriangleAlert`, `CircleX`, `Info`, `Clock`, `LoaderCircle` (the only spinner),
    `CircleMinus`, `SearchX`.
  - Orders and logistics: `ShoppingBag` (orders), `Inbox`, `Package`, `PackageCheck` (sold), `RotateCcw` (returns),
    `Truck`, `MapPin`, `Map`, `Tag` (products), `Sparkles` (AI assistant **only**).
  - Money: `CreditCard`, `Wallet`, `Scale`, `Banknote`, `ArrowDownLeft` (in), `ArrowUpRight` (out),
    `ArrowLeftRight`, `Receipt`, `Timer`.
  - People: `Users`, `UserCheck`, `UserPlus`, `UserX`, `Store`, `Building2`, **`Headset` (operator)**, `Phone`,
    `Bell`, `MessageSquareText`.
  - Data and charts: `ListFilter`, `ListX`, `ArrowUpDown`, `Calendar`, `CalendarClock`, `History`, `ChartColumn`,
    `TrendingUp` / `Down`, `Gauge`, `Trophy`.
  - Tools and system: `ScanLine`, `QrCode`, `Printer`, `KeyRound`, `Lock`, `Link`, `Webhook`, `LogOut`, `Settings`,
    `Sun` / `Moon`, `Languages`.

### 1.11 Charts

- Lines are 2 px. Bars are at most 24 px wide, with a top radius of 4.
- Grid lines are horizontal only, in `border`. Axis text is 12 px `subtle`.
- **There are no dual-axis charts.**
- Every chart has a «Grafik» / «Jadval» twin. Text is never drawn in a series colour.
- At most 8 categories; the rest go into «Boshqa».
- Light-theme series 3, 4 and 5 fall below 3:1 on white, so they need a label or the table view.
- A good/bad series (paid vs pending, sold vs cancelled) uses **status tokens**.
- Success-rate gauge zones: success at 70 % or more, warning at 40–70, danger below 40.
- Map and heat charts use one blue sequential scale.

### 1.12 Copy rules

- **Language:** Uzbek Latin in sentence case. No Title Case and no English words: «Bosh sahifa», «Excelga yuklash»,
  «Operatsiyalar tarixi», never «Dashboard» or «Export».
- **Confirm buttons:** an exact verb. A toast title has 2–4 words.
- **Error text:** plain Uzbek only, with no technical text (owner, 2026-10-19).
- **Empty states:** say why it is empty and what to do next.
- **Missing backend:** do not draw a field or feature the backend does not provide. Mark it «Taklif».
- **Feature names:** use the owner's words — **«sotuvchi sahifasi»**, not «oqim».

### 2.3 Hard rules (no variant may break these without an owner decision)

1. Colours come only from the token set. **No purple or indigo.** **Blue is only for interactive elements**.
2. **No gradients.** Fills are flat tokens.
3. **No custom shadows.** Cards are flat with a 1 px border. Shadows are only for floating layers.
4. **No text below 12 px**.
5. **Weights 400–700 only.** No 800 or 900.
6. **One primary action per screen**: at the right of the page header, or full width at the bottom on a phone.
7. **No card within a card within a card.** Two levels at most.
8. A status is never shown by colour alone. Badges use a dot and no icon.
9. **Icons are lucide only**: stroke 2, `currentColor`, sizes 16–24. No emoji and no filled icons. A text button has
   one icon or none.
10. **Light is the default.** Every screen is drawn in light and dark.
11. **Phone rules:**
    - every tap target is at least 44 px;
    - tables become cards;
    - with 3 or more filters, a «Filtrlar» button opens a sheet;
    - dialogs become sheets;
    - there is no horizontal scroll;
    - inputs use 16 px text.

12. Copy is Uzbek Latin in sentence case, with no English. Confirm buttons use exact verbs.
13. Formats follow §1.9, including the true minus sign and space thousands.
14. Money transfers, deactivation and end-of-day actions always go through a confirm dialog.
15. **Do not draw what the backend cannot give.** Mark it «Taklif» instead.
16. **Every number needs a source**, and no threshold or rule may be invented.
17. Features are named in the owner's words. Marketplace apostrophes are ‘ and ’.

### 3.1 Logo

**Lockup: «ELCHI POCHTA».** The emblem sits on the left, with the wordmark on the right.

- **Emblem:** symmetric, built from flat rounded shapes with narrow gaps between them.
  - A solid **circle** (the head) sits at the top centre.
  - Two long rounded bars rise diagonally outward, like **raised arms** forming a V or Y.
  - Below them, curved **leaf- or wing-shaped panels** fold inward and meet in a point at the bottom.
  - It reads as a person with raised arms over an open book, shield or envelope.
- **Wordmark:** «ELCHI» in heavy geometric uppercase sans with tight spacing. «POCHTA» sits below it in smaller
  medium-weight uppercase, very widely spaced so that it spans the width of «ELCHI».
- **Style:** one flat colour, with no outline, shadow or gradient.

**Logo book** (`assets/logo-book-ELCHI.pdf`):

- Exported from CorelDRAW 2025 on 2026-01-30, as one long page with the text converted to curves.
- Versions shown: navy on `#f4f8ff`, white on navy, black on white, and white on black.
- Palette («Цветовая гамма»):
  - navy **#1f2853** (C87 M81 Y36 K37, R31 G40 B83);
  - «WHITE» **#f4f8ff** (C3 M1 Y0 K0, R244 G248 B255).
- Font: **«HECTOR»**. Paraphrasing the book, in Russian: Hector is for body text and for headlines and slogans in
  ads, weights may be combined, and other typefaces are strongly discouraged for brand recognition.
- It gives no clear-space or minimum-size rules.
