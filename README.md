# Elchi Marketplace

Ko'p sotuvchili (multi-vendor) marketplace — istalgan odam ro'yxatdan o'tib, sotuvchi
kabinetida mahsulot joylaydi, ko'p omborli sklad boshqaradi, online sotadi. Yetkazib
berish **Elchi pochta** bilan Partner API orqali integratsiya qilingan.

> **Bu alohida, mustaqil loyiha.** Elchi pochta (`Elchi-Backend`) monorepo'sidan
> ajratilgan: o'z serveri, o'z DB'si, o'z git repo'si. Elchi'ga faqat toza HTTP
> kontrakt (Partner API + webhook) orqali ulanadi.

## Holat

🟡 **Rejalashtirish bosqichi.** Hali kod yozilmagan.

- To'liq texnik reja (PRD): [`docs/MARKETPLACE_PLAN.md`](./docs/MARKETPLACE_PLAN.md)
- Elchi integratsiya kontrakti: `../Elchi-Backend/docs/PARTNER_API.md`

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
