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

## Yangi microservice qo'shish (shablon)

`apps/echo-service` — eng qisqa namuna: `ConfigModule → connectMicroservice(rmqOptions) →
startAllMicroservices`, `@MessagePattern({ cmd: '...' })`. `identity-service` — DB'li to'liq
namuna (TypeORM + entity + auth). Yangi servisni `nest-cli.json`'ga qo'shing.
