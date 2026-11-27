# BE-32: sotuvchi kartasiga pul o‘tkazish (TZ MOL-6, T02:85)

Provayder EQ-08 da tanlanadi (tavsiya — Multicard). Bu yerda provayderga bog‘liq bo‘lmagan yadro va unga ulanadigan umumiy
HTTP shakl. `PAYOUT_API_URL` bo‘sh bo‘lsa hammasi o‘chiq: kabinetda «Kartani ulash» yo‘q (`enabled: false`), moliya pulni
qo‘lda o‘tkazib «To‘landi» bosadi (BE-23).

## Yoqish (deploy, Dilshod)

1. `.env.production` — `finance-service` va `api-gateway` ga:
   - `PAYOUT_API_URL` (prod’da faqat `https`), `PAYOUT_API_TOKEN`;
   - `PAYOUT_WEBHOOK_SECRET` (kamida 16 belgi);
   - `PAYOUT_SECRET_KEY` (kamida 32 belgi; karta tokenini shifrlaydi — **almashtirilsa ulangan kartalar ochilmaydi**, sotuvchilar qayta ulaydi);
   - `PAYOUT_RETURN_URL` — karta ulangach provayder sotuvchini qaytaradigan kabinet sahifasi.
   URL bo‘lib kalitlar bo‘lmasa servislar ishga tushmaydi.
2. Provayderda webhook: `https://<api>/api/v1/webhooks/payout`.
3. Migratsiya finance `1799107200000` (deploy bilan o‘zi ishlaydi).

**Provayder ishlamay qolsa:** yuborilgan so‘rovlar «Yuborilmoqda» da turadi, qayta yuborilmaydi. Moliya provayder
kabinetida tekshirib «Natijani kiritish» bilan yopadi. Yangi so‘rovlarni qo‘lda o‘tkazish uchun `PAYOUT_API_URL` bo‘shatilib
finance va gateway qayta ishga tushiriladi — tasdiqlangan so‘rovlar «Tasdiqlandi» da qoladi.

## Holatlar

So‘raldi → Tasdiqlandi → (kartasi bo‘lsa) **Yuborilmoqda** (`PAYING`) → To‘landi / **O‘tmadi** (`FAILED`).

- Band summa — So‘raldi, Tasdiqlandi, Yuborilmoqda.
- `FAILED` — ledgerga hech narsa yozilmagan, pul «Mavjud» da (MOL-6). Kunni band qilmaydi — sotuvchi o‘sha kuni yangi so‘rov
  yuboradi [taklif].
- Yuborishdan oldin qulf ostida qayta tekshiriladi: tasdiqlar soni, maqom, mavjud balans **minus shu sotuvchining boshqa
  «Yuborilmoqda» so‘rovlari** (ular ledgerda hali yechilmagan). Yetmasa — «Tasdiqlandi» da qoladi (soatda bir qayta
  ko‘riladi), moliya qaror qiladi. Qo‘lda «To‘landi» ham shu qoida bilan.
- Kartaga avtomatik ketadigan so‘rovga (`autoPayout: true` — yoqilgan va sotuvchida karta bor) qo‘lda «To‘landi» yo‘q (409);
  kartaga to‘langaniga qo‘lda «To‘landi» ham 409 (jim 200 emas).
- `PAYING` ga qo‘lda «To‘landi» ham, «Rad etish» ham yo‘q (409) — faqat «Natijani kiritish».
- Karta yo‘q yoki provayder o‘chiq — «Tasdiqlandi» da qoladi, moliya qo‘lda (BE-23 yo‘li o‘zgarmagan).
- Har soat moliyaga, har so‘rov bir marta: 24 soatdan beri to‘lanmagan (So‘raldi, Tasdiqlandi, Yuborilmoqda; T01:498) va
  kartaga yuborilganiga 1 soat bo‘lib natijasi yo‘q («javob yo‘q») [taklif]. Navbatga yozilmasa — keyingi soatda qayta.

**Provayder javoblari:**

| Javob | Nima bo‘ladi |
| --- | --- |
| `SUCCESS` | «To‘landi» (jurnal), sotuvchiga «Pul o‘tkazildi» |
| `FAILED` yoki HTTP 400, 422 | «O‘tmadi», pul «Mavjud» da; sotuvchiga provayder sababi yoki «Provayder to‘lovni rad etdi» (texnik matn faqat logda) |
| ulanib bo‘lmadi, HTTP 401, 403, 429 | provayder bajarmagan — «Tasdiqlandi» ga qaytadi, 1 soatdan keyin **o‘sha `payoutRef`** bilan qayta |
| `PENDING`, 5xx, 404, 408, 409, 425, 10 s javobsiz | noma’lum — «Yuborilmoqda», holat har daqiqa so‘raladi, qayta yuborilmaydi |

**«Natijani kiritish» (moliya):** avval holat provayderdan so‘raladi. Provayder «o‘tdi» desa — so‘rov o‘zi «To‘landi» bo‘ladi
(«o‘tmadi» kiritilgan bo‘lsa 409); «kutilmoqda» — 409; «rad etdi» bo‘lsa «To‘landi» kiritib bo‘lmaydi. Provayder bilmasa yoki
javob bermasa — yuborilganiga kamida 1 soat bo‘lishi kerak [taklif]. Moliya izohi `payout_note` da (sotuvchiga ko‘rinmaydi);
sotuvchiga «To‘lov kartaga o‘tmadi».

**Ziddiyat:** natija kiritilgandan keyin provayder boshqa natija bersa:
- «O‘tmadi» edi, provayder «o‘tdi» — pul ketgan: so‘rov «To‘landi» bo‘ladi (jurnal), sotuvchining keyingi yuborishlari
  balans tekshiruvida to‘xtaydi; moliyaga «provayder natijasi zid» xabari, so‘rovda `payoutConflict`.
- «To‘landi» edi, provayder «o‘tmadi» — avtomatik qaytarilmaydi; moliyaga xabar, `payoutConflict`.

## Provayder shakli (bitta adapter — `apps/finance-service/src/payout/payout.provider.ts`)

Provayder tanlangach yo shu klass uning API siga yoziladi, yo oraliq ko‘prik quyidagini gapiradi.
`Authorization: Bearer <PAYOUT_API_TOKEN>`.

| So‘rov | Tana | Javob |
| --- | --- | --- |
| `POST {URL}/card-sessions` | `{sessionRef, returnUrl, pinfl}` | `{url}` — https sahifa; sotuvchi kartani shu yerda kiritadi. `pinfl` — tasdiqlangan JShShIR (karta egasini tekshirish, EQ-08) yoki null |
| `POST {URL}/payouts` | `{payoutRef, cardToken, amount, currency: 'UZS', purpose}` | `{status: SUCCESS \| PENDING \| FAILED, reason?}`. HTTP 400 yoki 422 — aniq rad (`FAILED`, sabab bilan); ulanib bo‘lmadi, 401, 403, 429 — yuborilmagan («Tasdiqlandi» ga qaytadi, keyin o‘sha `payoutRef` bilan qayta); 5xx, 404, 409, 10 s javobsiz yoki holatsiz javob — noma’lum (`PAYING`, holat so‘raladi). Qaysi kod qaysi turga — provayder hujjati bilan aniqlanadi [taklif, EQ-08] |
| `GET {URL}/payouts/{payoutRef}` | — | `{status, reason?}`; 404 — topilmadi (qayta yuborilmaydi) |

`payoutRef` = `wd-<so‘rov ID>-<8 hex>` — bitta so‘rov, bitta chiqim; so‘rovga bir marta beriladi (tasodifiy qism — boshqa
muhit yoki tiklangan baza bilan to‘qnashmasin). `amount` — net (so‘rov − 1% soliq).

## Webhook

`POST /api/v1/webhooks/payout`, sarlavha `X-Payout-Signature` — xom tananing HMAC-SHA256 i (hex). 503 — provayder qayta
yuboradi; takror `eventId` bir marta ishlanadi. Ortiqcha maydonlar tashlanadi; token navbatga shifrlangan holda yoziladi.

| `type` | Maydonlar |
| --- | --- |
| `card.bound` | `eventId`, `sessionRef` (UUID), `cardToken`, `mask` — faqat `8600 **** **** 1234` shakli, `system?` (`UZCARD`, `HUMO`), `holderName?` |
| `payout.status` | `eventId`, `payoutRef`, `status` (`SUCCESS`, `PENDING`, `FAILED`), `reason?` |

Sessiya bir martalik (ikkinchi `card.bound` tashlanadi). Yangi karta eskisining o‘rnini oladi.

## API

| Yo‘l | Kim | Nima |
| --- | --- | --- |
| `GET /affiliate/payout-card` | sotuvchi | `{enabled, card: {mask, system, holderName, boundAt} \| null}` |
| `POST /affiliate/payout-card/session` | sotuvchi | `{url, expiresAt}` (15 daqiqa); o‘chiq — 503 `PAYOUT_NOT_CONFIGURED`; provayder bermadi — 502 `PAYOUT_FAILED` |
| `DELETE /affiliate/payout-card` | sotuvchi | karta o‘chiriladi (yuborilganlarga ta’sir qilmaydi) |
| `POST /admin/finance/withdrawals/{id}/payout-result` | moliya, superadmin | `PAYING` ni yopish: `{result: PAID \| FAILED, note}`; audit `withdrawal.payout.resolve` |
| `WithdrawalDto` | — | yangi maydonlar: `payoutMode` (`MANUAL` / `CARD`), `cardMask`, `payoutSentAt`, `failReason`, `failedAt`, `autoPayout` (qo‘lda «To‘landi» ni yashirish), `payoutConflict` (faqat moliya ro‘yxatida); holatlar `PAYING`, `FAILED` |

## Xabarlar

- To‘landi — sotuvchiga «Pul o‘tkazildi» SMS (BE-24 bilan bir xil; qo‘lda va kartaga — bitta `dedupeKey`).
- O‘tmadi — sotuvchiga SMS va kabinet («… kartangizga o‘tmadi. Pul balansingizda qoldi …»), moliyaga kabinet.
- 24 soat va «javob yo‘q» — moliyaga kabinet.
- Provayder natijasi zid — moliyaga kabinet.

## Saqlanadigan ma’lumot (TC3)

`finance.payout_card`: shifrlangan token (`token_cipher`), niqob, tizim, egasi ismi. `withdrawal_request` ga yuborilgan
karta nusxasi (T02:85: «karta tokeni, niqoblangan karta raqami»). To‘liq karta raqami uchun ustun yo‘q; niqob formati
bazada CHECK bilan qotirilgan.
