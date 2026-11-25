# Sotuvchining JShShIR arizasi (SOT-1, TZ 8; FE-04)

Ega qarori (2026-11-25): sotuvchi JShShIR va maqom ma’lumotnomasini kabinetdan o‘zi yuboradi, moliya qo‘lda tekshiradi.
Maqom tasdiqlanmaguncha pul yechish yopiq (BE-23, T01:471). Avtomatik tekshiruv va javob muddati yo‘q (23-qaror).

## Holatlar

`NOT_SUBMITTED` → `PENDING` → `VERIFIED` yoki `REJECTED`; `VERIFIED` → `REVOKED`. Rad va bekordan keyin qayta yuboriladi.
Har yuborish — alohida qator (`finance.self_employed_application`), amaldagisi — oxirgisi. Pul yechish darvozasi
`finance.affiliate_payout_profile.self_employed` — har qaror bilan bitta tranzaksiyada, pul yechish qulfi ostida.

**Ism-familiya o‘zgarsa** (`PATCH /affiliate/profile`): avval moliya maqomni qayta tekshiruvga qo‘yadi (yangi `PENDING`,
eskisi `SUPERSEDED`, pul yechish yopiladi), keyin ism yangilanadi. Moliya javob bermasa ism ham o‘zgarmaydi. Tasdiqda
profildagi ism arizadagi bilan solishtiriladi: farq qilsa ariza hozirgi ism bilan yangilanadi va 409 `NAME_CHANGED`.

**Pul o‘tkazishdan oldin** (`POST admin/finance/withdrawals/:id/approve`) maqom va tasdiqlangan ism yana tekshiriladi:
maqom yo‘q — 400; ism boshqa — 409 `NAME_CHANGED`, maqom qayta tekshiruvga tushadi va pul yechish yopiladi.

## API

| Yo‘l | Kim | Nima |
| --- | --- | --- |
| `POST /affiliate/self-employed/document` | sotuvchi | Ma’lumotnoma (multipart `file`; PDF, JPG, PNG, 10 MB), ixtiyoriy |
| `POST /affiliate/self-employed` | sotuvchi | `{pinfl, documentId?}` |
| `GET /affiliate/self-employed/document` | sotuvchi | O‘z hujjati |
| `GET /affiliate/profile` → `selfEmployed` | sotuvchi | Holat, oxirgi 4 raqam, sabab, izoh |
| `GET /admin/finance/self-employed`, `/:id` | admin, moliya, superadmin | Navbat; mavjud pul; shu JShShIR bilan boshqa sotuvchilar |
| `POST …/:id/reveal`, `GET …/:id/document` | moliya, superadmin | To‘liq JShShIR, hujjat — avval audit (yozilmasa 503) |
| `POST …/:id/approve`, `/reject`, `/revoke` | moliya, superadmin | Qaror; rad va bekorda sabab majburiy |
| `PUT /admin/finance/affiliates/:id/self-employed` | moliya, superadmin | Arizasiz qo‘lda (BE-23); ochiq ariza bo‘lsa 409 |

Xatolar: `PINFL_INVALID`, `PROFILE_NAME_REQUIRED`, `DOCUMENT_NOT_FOUND`, `FILE_REQUIRED`, `FILE_TYPE_INVALID` 400;
`FILE_TOO_LARGE` 413; `ALREADY_PENDING`, `ALREADY_VERIFIED`, `NAME_CHANGED` 409; kalit yo‘q — 503; superadmin «nomidan
ko‘rish» rejimida — 403. Yuklash va yuborish — IP dan daqiqasiga 10 ta [taklif].

## Shaxsiy ma’lumot

- JShShIR AES-256-GCM bilan shifrlangan: gateway shifrlaydi, finance tekshiradi va shunday saqlaydi — servislararo
  xabarda, navbatda va DLQ da ham ochiq raqam yo‘q. Ochiq faqat oxirgi 4 raqam. Kalitli xesh — bir JShShIR ikki
  sotuvchida ekanini ko‘rsatish uchun (faqat ogohlantirish [taklif]).
- Kalit `SELF_EMPLOYED_SECRET_KEY` (kamida 32 belgi; gateway va finance-service). Yo‘q bo‘lsa yangi ariza 503. Bir marta
  qo‘yiladi: almashtirilsa eski raqamlar ochilmaydi (`reveal` 409 — arizani rad eting, sotuvchi qayta yuboradi).
- Hujjat: yuborilgunga qadar `private-uploads/affiliate/<id>/` (1 kunda o‘chadi), yuborilgach `private/affiliate/<id>/`.
  Ochiq URL yo‘q — faqat gateway orqali, egasiga yoki moliyaga.
- Audit: `self-employed.submit`, `.reveal`, `.document`, `.approve`, `.reject`, `.revoke`, `.recheck` (ism o‘zgardi), `.manual`
  (qo‘lda belgi) — to‘liq raqamsiz.

## Deploy

Migratsiya finance `1798761600000` (eski qo‘lda belgilar `MANUAL` bo‘lib ko‘chadi). Env: `SELF_EMPLOYED_SECRET_KEY`.
