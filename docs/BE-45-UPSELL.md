# BE-45: qo‘shimcha tovar (upsell va cross-sell)

TZ: 6.3 OPR-4 (buyurtmani rasmiylashtirishda upsell va cross-sell takliflari), OPR-7 (upsell %), 5-bo‘lim 12-qoida
(«Qo‘shimcha tovar taklifi faqat 09:00–18:00» — «Taklif — tasdiqlash kerak»), 9-bo‘lim («Upsell foizi»: qo‘shimcha
tovarli buyurtmalar / barcha buyurtmalar). EQ-14 qarori hali yo‘q — ega buyrug‘i bilan quriladi (2026-11-28);
qarorga bog‘liq joylar [taklif].

## Nima qiladi

1. **Juftlik (admin).** `PUT /admin/products/{id}/upsell-pair` `{ productId | null }` — operator shu mahsulot liddida
   taklif qiladigan boshqa mahsulot (admin-offer dizayni, bitta juftlik offer bo‘yicha) [taklif]. O‘zi bilan — 400;
   arxivdagi, rad etilgan yoki CPA o‘chirilgan — 409. Audit: `product.upsell-pair`. `ProductDto.upsellProductId`,
   offer snapshotida `upsellProductId`.
2. **Operator ekrani.**
   - `GET /operator/leads/{id}/upsell` — juftlik (narx, qoldiq, og‘irlik, rasm, taklif qilib bo‘lmasa sababi:
     `IN_LEAD`, `OUT_OF_STOCK`, `NO_PRICE`, `UNAVAILABLE`), 12-qoida oynasi, qo‘shilgan qatorlar, oxirgi «Mijoz olmadi».
   - `POST /operator/leads/{id}/items` `{ productId, quantity }` — faqat bronlagan operator, faol suhbatda (`BOOKED`).
     Narx yuborilmaydi (`price` bilan — 400): tasdiqlangan narx (BE-09) olinadi. Qoldiq yetmasa — 400 (TC2), ombor
     javob bermasa — 503. Lidda bor tovar — 409. Javob — yangilangan lid kartasi: `items` (`itemId`, `upsell`) va
     `price` — butun posilka (yetkazish bir marta, og‘irliklar yig‘indisi).
   - `DELETE /operator/leads/{id}/items/{itemId}` — faqat qo‘shimcha qator.
   - `POST /operator/leads/{id}/upsell/decline` — «Mijoz olmadi», lid tarixiga yoziladi [taklif].
   - Qo‘shish, olib tashlash va rad — lid tarixida (kim, nima, narx).
3. **Tasdiq.** «Tasdiqlandi» dan oldin qo‘shimcha tovar narxi katalog bilan solishtiriladi: o‘zgargan bo‘lsa qator yangi
   narxga yangilanadi va 409 — operator mijozga yangi summani aytadi. `lead.confirmed` hamma qatorlar bilan ketadi,
   qo‘shimchasi `upsell: true` (BE-34 dagi ko‘p tovarli tartib).
4. **Buyurtma (checkout).** Bitta buyurtma, bitta posilka, har tovar o‘z qatori; qo‘shimcha qator `is_upsell`.
   Qo‘shimcha qator narxi aynan tasdiqlangan narx bo‘lmasa — buyurtma yaratilmaydi (`PRICE_CHANGED`, TC3).
   Sayt bo‘lmagan lidda faqat `upsell` belgili qo‘shimcha qatorlar qabul qilinadi.
5. **Pul.** Qo‘shimcha qatorda ustama yo‘q; **sotuvchi haqi platformada qoladi** [taklif, EQ-14 — ochiq savol]:
   `affiliate_fee` 0, haq `platform_service` ga qo‘shiladi. Moliya (`split.ts`) o‘zgarmadi — tenglama saqlanadi.
6. **Statistika.** `GET /operator/stats` → `upsellRate`: shu davrda tasdiqlaganlaridan qo‘shimcha tovarlilari /
   tasdiqlaganlari (TC5).

## Sozlama

| O‘zgaruvchi | Servis | Ma’nosi |
| --- | --- | --- |
| `UPSELL_WINDOW` | lead-service | 12-qoida oynasi, Toshkent vaqti, masalan `09:00-18:00` (18:00 ning o‘zi tashqarida). Bo‘sh — qoida o‘chiq (sukut: qoida tasdiqlanmagan). Noto‘g‘ri yozilsa — qo‘shish yopiq va log’da xato. |

## Migratsiyalar

- catalog `1799366400000` — `product.upsell_product_id` (FK, `ON DELETE SET NULL`, o‘zi bilan CHECK).
- lead `1799366400000` — `lead_item.is_upsell`, `added_by`, `added_at`, qisman indeks.
- checkout `1799366400000` — `sales_order_item.is_upsell`.

## Ochiq savollar (egaga)

`elchi-lid-sotuv` reposi, `mvp-plan/tahlil-2026-11-28/be45/savollar.md`.
