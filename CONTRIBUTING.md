# Hissa qo'shish qo'llanmasi

## Muhitni tayyorlash

```bash
npm install                 # husky hook'lari ham o'rnatiladi (prepare)
cp .env.example .env
npm run infra:up            # docker: postgres/rabbitmq/minio/adminer
```

Node **20+** va **Docker** kerak. `.env` HECH QACHON commit qilinmaydi.

## Ish jarayoni (Trello + Git)

1. Trello'da card'ni **In Progress**ga o'tkazing.
2. Card kodidan branch oching: `feat/cX.Y-qisqa-nom` (masalan `feat/c0.6-catalog-entities`).
3. Kod yozing. Har commit'da husky **lint-staged** ishlaydi (o'zgargan `.ts` lint + format).
4. **PR** oching → **Lead review** → `main`ga merge.

Commit uslubi: `feat(cX.Y): ...`, `fix: ...`, `docs: ...`, `test: ...`.

## Definition of Done (har card)

- [ ] Acceptance to'liq bajarilgan
- [ ] Card ichidagi **🧪 Test (Done'dan oldin)** checklisti 100% ✓ (qo'lda tekshirilgan)
- [ ] `npm run lint`, `npm run format:check`, `npm run build:all`, `npm test` — hammasi yashil
- [ ] PR ochilgan, Lead review qilgan, `main`ga merge
- [ ] Kerak bo'lsa Swagger/README yangilangan

> Checklist 100% bo'lmasa card **Done'ga o'tmaydi**. CI (GitHub Actions) ham har PR'da
> lint + format + build + test'ni tekshiradi — qizil bo'lsa merge qilinmaydi.

## Konvensiyalar

- **Til:** izoh/xabarlar o'zbekcha (lotin). Kod (o'zgaruvchi/funksiya) inglizcha.
- **Javob:** `{ statusCode, message, data }` (TransformInterceptor avtomat).
- **Xato:** `BusinessException` + barqaror `errorCode` (API_CONTRACT.md §1.5).
- **Servislararo:** RMQ `{ cmd: '<servis>.<amal>' }`; cross-schema SQL FK YO'Q (API/event).
- **Pul:** `numeric(14,2)` + `numericTransformer`. **ID:** bigint (JS'da string).
- Umumiy kod `libs/common`'da — takrorlamang, shu yerdan import qiling (`@app/common`).

## Kod tashkiloti va takrorlamaslik (DRY) — MAJBURIY

> Maqsad: kod tartibli, mantiqiy fayllarga bo'lingan bo'lsin va **bir xil kod 2 marta
> yozilmasin**. Quyidagilar PR review'da tekshiriladi — buzilsa merge qilinmaydi.

**1. Bitta fayl = bitta mas'uliyat.** Har entity/service/controller/guard/DTO alohida
faylda. Bir faylga bir nechta klass tiqilmaydi. Fayl ~300 qatordan oshsa — bo'lib tashlang
(masalan `inventory.service.ts` + `reservation-sweeper.service.ts` + `inventory-outbox-relay.service.ts`).

**2. Servis papka konvensiyasi** (barcha servislarda bir xil):
```
apps/<svc>/src/
  entities/         # har jadval alohida *.entity.ts; domen enum'lari *.enums.ts
  migrations/       # har migratsiya alohida fayl (timestamp nom)
  dto/              # request/response DTO (controllerda inline YOZILMAYDI)
  <svc>.service.ts  # biznes-mantiq
  <svc>.module.ts   # wiring
  main.ts           # bootstrap
```

**3. Umumiy kodni HECH QACHON ko'chirib yozmang.** Agar biror kod 2-chi servisda kerak
bo'lsa — uni `libs/common`ga ko'chiring va `@app/common`'dan import qiling. Umumiy joyi bor:
`BaseEntity`, `numericTransformer`, `typeOrmOptions`, `ensureSchema`, guards, decorators,
filters, interceptors, DTO, security (crypto/hmac/ssrf), messaging (rmq/rpc/execute-and-ack),
`BusinessException` + `errorCode`. **Yangi umumiy narsani `libs/common/src/index.ts`'ga export qiling.**

**4. "Uch marta" qoidasi (Rule of Three).** Bir xil kod blogini 3-marta yozayotgan bo'lsangiz —
to'xtang, uni helper/util/base-klassga chiqaring. 2-marta — ogohlantirish, 3-marta — taqiq.

**5. Enum qayerda?** Bir nechta servis ko'radigan enum (`Role`, umumiy status) → faqat
`libs/common/src/enums`. Faqat bitta servis ichidagi domen enum (masalan `StockMovementType`,
`ReservationStatus`) → shu servisning `entities/*.enums.ts`'ida. **Enum ikki joyda takrorlanmaydi.**

**6. DB/config sozlamasini takrorlamang.** TypeORM ulanish `typeOrmOptions(config, '<schema>', entities)`
helper'i orqali (har modulda qo'lda `host/port/user` yozilmaydi). Config validatsiya —
`CommonConfigModule` (Joi). Yangi env o'zgaruvchi — `env.validation.ts`'ga qo'shiladi.

**7. Nomlash.** Fayl `kebab-case` (`product-variant.entity.ts`), klass `PascalCase`,
o'zgaruvchi/funksiya `camelCase`, enum qiymati `UPPER_SNAKE`. Kod inglizcha, izoh o'zbekcha.

**8. Ma'lum takror (TODO):** microservice `main.ts` fayllari deyarli bir xil — kelgusida
`bootstrapRmqMicroservice(module, queue)` helper'iga chiqariladi (`libs/common/messaging`).

## Yangi microservice qo'shish (shablon)

`apps/echo-service` — eng qisqa namuna: `ConfigModule → connectMicroservice(rmqOptions) →
startAllMicroservices`, `@MessagePattern({ cmd: '...' })`. `identity-service` — DB'li to'liq
namuna (TypeORM + entity + auth). Yangi servisni `nest-cli.json`'ga qo'shing.
