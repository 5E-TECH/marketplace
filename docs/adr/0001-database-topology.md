# ADR 0001 — Database topologiyasi: 1 Postgres + schema-per-service

- **Sana:** 2026-07-21
- **Status:** Qabul qilindi (Accepted)
- **Kontekst:** Elchi Marketplace — standalone multi-vendor marketplace, NestJS
  microservices monorepo, 3 kishilik jamoa (Lead + Dilshodbek backend + Bahodir frontend),
  MVP bosqichi.

## Qaror

Hozircha **bitta PostgreSQL instance** ishlatamiz, har mikroservis uchun **alohida schema**
(`identity, catalog, inventory, checkout, payment, finance, integration, notification, search`).

Fizik alohida DB (database-per-service) HOZIRCHA yaratilmaydi.

## Ko'rib chiqilgan variantlar

| Variant | Chegara | Tranzaksiya | Ops | Split (keyin) | Kim uchun |
|---|---|---|---|---|---|
| A) 1 DB, 1 umumiy schema | yo'q | oson | 1 ta | qiyin | kichik monolit |
| **B) 1 DB, schema-per-service** ✅ | mantiqiy toza | servis ichida ACID | 1 ta (oson) | oson | kichik–o'rta jamoa, MVP |
| C) Har servisga fizik DB | fizik toza | distributed (saga) | N ta (murakkab) | kerak emas | katta jamoa, yuqori masshtab |

## Nega B (va nega C emas)

- **C ning narxi 3 kishi uchun og'ir:** distributed tranzaksiya (checkout→reserve→payment→shipment
  bitta ACID'da bo'lolmaydi), cross-service JOIN yo'q, N ta bazani backup/migrate/monitoring.
- **B 90% foydani arzonga beradi:** har servis o'z schema'siga egalik qiladi (chegara saqlanadi),
  bitta baza (oson ops), servis ichida oddiy ACID ishlaydi.
- **Xavfsizlik B'da ham kuchli:** har servisga alohida DB user, faqat o'z schema'siga ruxsat
  (least-privilege). Bitta bazani to'g'ri himoya qilish 3 kishida 9 tasidan realroq.

## Cheklovlar (majburiy qoidalar)

1. **Cross-schema FK YARATILMAYDI.** Servislararo havola = oddiy `BIGINT` ustun; bog'lanish
   API/event orqali. (drawSQL diagrammasida chiziq bo'lishi mumkin, real migratsiyada — yo'q.)
2. Har servis faqat **o'z schema'sidagi** jadvalga so'rov yuboradi (cross-schema query yo'q).
3. Har servisning DB user'i faqat o'z schema'siga `USAGE` + DML oladi (`00-bootstrap.sql`).

## Qachon C ga o'tamiz (trigger shartlari)

Quyidagilardan biri yuz berganda **faqat o'sha issiq servisni** alohida instance'ga ko'chiramiz:
- bitta servis (masalan `payment` yoki `inventory`) DB yuklamasi umumiy bazani bo'g'sa;
- alohida SLA/compliance yoki alohida backup/restore siyosati talab qilinsa;
- jamoa kattalashib, servis alohida deploy/scale qilinishi kerak bo'lsa.

O'tish arzon, chunki chegara allaqachon toza:
`pg_dump -n <schema>` → yangi instance → app faqat connection string'ini o'zgartiradi, kod tegmaydi.

## Oqibatlar

- (+) Tez ishga tushirish, oson debug, arzon infra, kelajakda oson split.
- (−) Bitta instance = umumiy resurs (bitta og'ir servis boshqasiga ta'sir qilishi mumkin) —
  monitoring bilan kuzatiladi, trigger shartlarida hal qilinadi.
