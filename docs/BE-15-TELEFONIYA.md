# BE-15: telefoniya (TZ 6.4 TEL-1–5, TEL-7; OPR-6)

Provayder EQ-02 da tanlanadi. Bu yerda provayderga bog‘liq bo‘lmagan yadro va unga ulanadigan umumiy HTTP shakl.
`TELEPHONY_API_URL` bo‘sh bo‘lsa hammasi o‘chiq: «Qo‘ng‘iroq» tugmasi ishlamaydi, natija BE-13 dagidek qo‘lda.

## Yoqish (deploy, Dilshod)

1. `.env.production`: `TELEPHONY_API_URL`, `TELEPHONY_API_TOKEN`, `TELEPHONY_WEBHOOK_SECRET` (kamida 16 belgi),
   `TELEPHONY_CALLER_ID` (+998…; berilmasa provayder o‘zi tanlaydi). O‘zgaruvchilar `lead-service` va `api-gateway` ga kerak.
2. Provayderda webhook: `https://<api>/api/v1/webhooks/telephony`.
3. Admin har operatorga telefon biriktiradi: `PUT /api/v1/admin/operators/{id}/phone` (`EXTENSION` 2–10 raqam yoki
   `MOBILE` +998XXXXXXXXX). Telefoni yo‘q operatorda tugma o‘chiq, natija qo‘lda.
4. Panel CSP `media-src` ga API domeni (yozuv gateway orqali keladi, provayder hosti kerak emas).

**Provayder ishlamay qolsa:** «javob bermadi», «band», «o‘chiq» faqat qo‘ng‘iroq holatidan qabul qilinadi (TEL-4), shuning
uchun operator bu natijalarni kirita olmaydi. `TELEPHONY_API_URL` ni bo‘shatib lead-service va gateway qayta ishga
tushiriladi (yoki operator telefoni olib tashlanadi) — natija yana qo‘lda.

## Provayder shakli (bitta adapter — `apps/lead-service/src/telephony/telephony.provider.ts`)

Provayder tanlangach yo shu klass uning API siga yoziladi, yo oraliq ko‘prik quyidagini gapiradi. Kirish —
`Authorization: Bearer <TELEPHONY_API_TOKEN>`.

| So‘rov | Tana | Javob |
| --- | --- | --- |
| `POST {URL}/calls` | `{callRef, operator: {kind, value}, customer, callerId, announceRecording: true}` | 2xx `{providerCallId}`; 4xx — boshlanmadi; 5xx yoki 3 s (TEL-2) javobsiz — natija noma’lum, hodisa kutiladi |
| `POST {URL}/calls/{callRef}/hangup` | `{}` | 2xx |
| `GET {URL}/recordings/{recordingRef}` | `Range` mumkin | 200/206 `audio/*`; 404 — saqlash muddati tugagan |

Tartib: avval operator telefoni, u javob bergach mijoz (ega qarori 2026-11-23); suhbat boshida «yozib olinadi» xabari
(TEL-5); mijozga mahalliy +998 raqam (TEL-1). Yozuv provayderda saqlanadi (TEL-6, EQ-02), bizda faqat kaliti.

## Webhook

`POST /api/v1/webhooks/telephony`, sarlavha `X-Telephony-Signature` — xom tananing HMAC-SHA256 i (`signHmacSha256`
shakli). 503 — provayder qayta yuboradi; takror `eventId` bir marta ishlanadi. Ortiqcha maydonlar tashlanadi.

| `type` | Maydonlar |
| --- | --- |
| `status` | `eventId, callRef, at, status` — `RINGING_OPERATOR`, `RINGING_CUSTOMER`, `CONNECTED` |
| `completed` | `eventId, callRef, at, endReason` — `ANSWERED`, `NO_ANSWER`, `BUSY`, `UNREACHABLE`, `OPERATOR_NO_ANSWER`, `CANCELLED`, `FAILED`; `ANSWERED` da `answeredAt`, `durationSeconds` |
| `recording` | `eventId, callRef, at, recordingRef` (URL emas) |

## API

| Yo‘l | Kim | Nima |
| --- | --- | --- |
| `POST /operator/leads/{id}/call` | operator, nazoratchi, superadmin | Qo‘ng‘iroq (lid shu odamning bronida) |
| `GET /operator/calls/{id}`, `POST …/hangup`, `GET /operator/calls` | o‘ziniki | Bosqich, taklif qilingan natija, tugatish, ro‘yxat |
| `GET /calls` | nazoratchi, admin, superadmin | Hisobot; `recording=MISSING` va `missingRecordings` — yozuvsizlar (TEL-3) |
| `POST /calls/{id}/recording-link` | operator (o‘ziniki), nazoratchi, admin, superadmin | Vaqtli havola; `DOWNLOAD` — admin, superadmin |
| `GET /call-recordings/{token}` | havola egasi | Audio oqimi (`Range`) |
| `GET/PUT/DELETE /admin/operators/{id}/phone` | admin, superadmin | Operator telefoni |

Audit: `call.recording.listen`, `call.recording.download`, `call.recording.denied` (yozilmasa havola berilmaydi),
`operator.phone.set`, `operator.phone.delete`.

## Xatolar

`TELEPHONY_NOT_CONFIGURED` 503, `TELEPHONY_FAILED` 502, `OPERATOR_PHONE_MISSING` 409, `CALL_ACTIVE` 409,
`CALL_REQUIRED` 409, `CALL_OUTCOME_MISMATCH` 409, `RECORDING_NOT_READY` 404.
