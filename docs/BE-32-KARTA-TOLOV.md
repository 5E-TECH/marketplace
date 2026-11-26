# BE-32: sotuvchi kartasiga pul o‘tkazish (TZ MOL-6, T02:85)

Provayder EQ-08 da tanlanadi (tavsiya — Multicard). Bu yerda provayderga bog‘liq bo‘lmagan yadro va unga ulanadigan umumiy
HTTP shakl. `PAYOUT_API_URL` bo‘sh bo‘lsa hammasi o‘chiq: kabinetda «Kartani ulash» yo‘q (`enabled: false`), moliya pulni
qo‘lda o‘tkazib «To‘landi» bosadi (BE-23).

## Yoqish (deploy, Dilshod)

1. `.env.production` — `finance-service` va `api-gateway` ga:
   - `PAYOUT_API_URL`, `PAYOUT_API_TOKEN`;
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
- Yuborishdan oldin qulf ostida qayta tekshiriladi: tasdiqlar soni, maqom, mavjud balans. Yetmasa — «Tasdiqlandi» da qoladi
  (soatda bir qayta ko‘riladi), moliya qaror qiladi.
- `PAYING` ga qo‘lda «To‘landi» ham, «Rad etish» ham yo‘q (409) — faqat «Natijani kiritish».
- Karta yo‘q — «Tasdiqlandi» da qoladi, moliya qo‘lda (BE-23 yo‘li o‘zgarmagan).
- 24 soatdan beri to‘lanmagan so‘rov (So‘raldi, Tasdiqlandi, Yuborilmoqda; T01:498) — moliyaga bir marta xabar (har soat).

## Provayder shakli (bitta adapter — `apps/finance-service/src/payout/payout.provider.ts`)

Provayder tanlangach yo shu klass uning API siga yoziladi, yo oraliq ko‘prik quyidagini gapiradi.
`Authorization: Bearer <PAYOUT_API_TOKEN>`.

| So‘rov | Tana | Javob |
| --- | --- | --- |
| `POST {URL}/card-sessions` | `{sessionRef, returnUrl, pinfl}` | `{url}` — https sahifa; sotuvchi kartani shu yerda kiritadi. `pinfl` — tasdiqlangan JShShIR (karta egasini tekshirish, EQ-08) yoki null |
| `POST {URL}/payouts` | `{payoutRef, cardToken, amount, currency: 'UZS', purpose}` | `{status: SUCCESS \| PENDING \| FAILED, reason?}`. 4xx yoki ulanib bo‘lmadi — aniq rad (`FAILED`); 5xx, 10 s javobsiz yoki holatsiz javob — noma’lum (`PAYING`, holat so‘raladi) |
| `GET {URL}/payouts/{payoutRef}` | — | `{status, reason?}`; 404 — topilmadi (qayta yuborilmaydi) |

`payoutRef` = `wd-<so‘rov ID>` — bitta so‘rov, bitta chiqim. `amount` — net (so‘rov − 1% soliq).

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
| `WithdrawalDto` | — | yangi maydonlar: `payoutMode` (`MANUAL` / `CARD`), `cardMask`, `payoutSentAt`, `failReason`, `failedAt`; holatlar `PAYING`, `FAILED` |

## Xabarlar

- To‘landi — sotuvchiga «Pul o‘tkazildi» SMS (BE-24 bilan bir xil; qo‘lda va kartaga — bitta `dedupeKey`).
- O‘tmadi — sotuvchiga SMS va kabinet («… kartangizga o‘tmadi. Pul balansingizda qoldi …»), moliyaga kabinet.
- 24 soat — moliyaga kabinet.

## Saqlanadigan ma’lumot (TC3)

`finance.payout_card`: shifrlangan token (`token_cipher`), niqob, tizim, egasi ismi. `withdrawal_request` ga yuborilgan
karta nusxasi (T02:85: «karta tokeni, niqoblangan karta raqami»). To‘liq karta raqami uchun ustun yo‘q; niqob formati
bazada CHECK bilan qotirilgan.
