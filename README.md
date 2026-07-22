# Elchi Marketplace

Ko'p sotuvchili (multi-vendor) marketplace — istalgan odam ro'yxatdan o'tib, sotuvchi
kabinetida mahsulot joylaydi, ko'p omborli sklad boshqaradi, online sotadi. Yetkazib
berish **Elchi pochta** bilan Partner API orqali integratsiya qilingan.

> **Bu alohida, mustaqil loyiha.** Elchi pochta (`Elchi-Backend`) monorepo'sidan
> ajratilgan: o'z serveri, o'z DB'si, o'z git repo'si. Elchi'ga faqat toza HTTP
> kontrakt (Partner API + webhook) orqali ulanadi.

## Holat

🟢 **Faza 0 — poydevor qurilmoqda.** Backend skeleti ishga tushdi (monorepo, gateway, identity).

- To'liq texnik reja (PRD): [`docs/MARKETPLACE_PLAN.md`](./docs/MARKETPLACE_PLAN.md)
- API kontrakt (endpoint DTO): [`docs/API_CONTRACT.md`](./docs/API_CONTRACT.md)
- DB sxema: [`docs/schema/`](./docs/schema/) · Hissa qo'shish: [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- Elchi integratsiya kontrakti: `../Elchi-Backend/docs/PARTNER_API.md`

## Ishga tushirish (dev)

Talab: **Node 20+**, **Docker**.

```bash
npm install
cp .env.example .env          # qiymatlarni to'ldiring (.env git'ga tushmaydi)
npm run infra:up              # postgres / rabbitmq / minio / adminer (docker)

npm run start:dev             # api-gateway   → http://localhost:3000/api/v1
npm run start:identity:dev    # identity-service (RMQ)
```

Tekshirish: `http://localhost:3000/api/v1/health` · Swagger: `http://localhost:3000/api/docs`

### Foydali buyruqlar

| Buyruq | Vazifa |
|---|---|
| `npm run build:all` | Barcha app'ni build qilish |
| `npm test` | Unit testlar (Jest) |
| `npm run lint` | ESLint tekshiruvi |
| `npm run format` | Prettier bilan formatlash |
| `npm run infra:down` | Docker xizmatlarni to'xtatish |

## Monorepo tuzilishi

```
apps/
  api-gateway/      HTTP kirish nuqtasi (JWT, Swagger, RMQ client)
  identity-service/ foydalanuvchi + auth (register/login)
  echo-service/     RMQ microservice shabloni
libs/
  common/           umumiy kod (BaseEntity, guards, filter, outbox, ...)
docs/               PRD, API kontrakt, DB sxema, Trello
```

## Stack (rejalashtirilgan)

- **Backend:** NestJS mikroservis monorepo (RabbitMQ, Postgres schema-per-service) — Elchi patterni
- **Storefront:** Next.js (SSR/SEO)
- **Seller cabinet:** React SPA
- **To'lov:** Payme / Click (escrow) + COD (Elchi orqali)
- **Sklad:** ko'p ombor + rezervatsiya

## Asosiy qarorlar

| Qaror | Tanlov |
|---|---|
| Model | Umumiy katalog + har sotuvchi alohida do'kon |
| To'lov | Online (Payme/Click) + COD |
| MVP | Sotuvchi kabineti birinchi |
| Sklad | Ko'p ombor + rezervatsiya |
| Pul | Aralash: online→escrow, COD→sotuvchiga (Elchi orqali) |
| Elchi ulanish | Partner API + outbound webhook |
