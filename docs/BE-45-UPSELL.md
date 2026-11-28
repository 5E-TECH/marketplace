# BE-45: qo‘shimcha tovar (upsell va cross-sell)

TZ: 6.3 OPR-4 (buyurtmani rasmiylashtirishda upsell va cross-sell takliflari), OPR-7 (upsell %), 5-bo‘lim 12-qoida
(«Qo‘shimcha tovar taklifi faqat 09:00–18:00» — ega 2026-11-28 da rad etdi, `UPSELL_WINDOW` bo‘sh qoladi), 9-bo‘lim («Upsell foizi»: qo‘shimcha
tovarli buyurtmalar / barcha buyurtmalar). EQ-14 qarori (ega, 2026-11-28): M2; narx — tasdiqlangan narx; sotuvchi haqi —
platformada; istalgan tovar, taklif — juftlik; «yana bir dona» upsell emas; 12-qoida yo‘q; operatorga upsell bonusi.

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
   - Juftlik — ekrandagi taklif; operator sotuvdagi istalgan boshqa tovarni ham qo‘sha oladi (mijoz o‘zi so‘rasa)
     (ega qarori, 98-savol). Narx baribir tasdiqlangan narx, haq platformada — pul xavfi yo‘q.
3. **Tasdiq.** «Tasdiqlandi» dan oldin har qo‘shimcha tovar katalog bilan qayta tekshiriladi: sotuvdan olingan, narxi
   tasdiqlanmagan yoki qoldig‘i yetmaydi — 409 (nomi bilan; olib tashlash yoki sonini kamaytirish kerak); narx
   o‘zgargan — qator yangi narxga yangilanadi va 409, operator mijozga yangi summani aytadi. Shunday qilib buyurtma
   qo‘shimcha tovar sababli yaratilmay, lid navbatga aylanib yurmaydi. `lead.confirmed` hamma qatorlar bilan ketadi,
   qo‘shimchasi `upsell: true` (BE-34 dagi ko‘p tovarli tartib).
   - **Qo‘shimcha tovar faqat bitta suhbat ichida yashaydi.** Lid tasdiqlanmasdan bronni tark etsa (boshqa natija,
     bron muddati tugadi, buyurtma yaratilmadi) — qo‘shimcha qatorlar olib tashlanadi va tarixga yoziladi: keyingi
     qo‘ng‘iroqda mijoz rozilik bermagan tovar buyurtmaga tushmaydi. Buyurtma yaratilmasa (qaysi qator sababli ekani
     noma’lum) — «qoldiq yo‘q» belgisi qo‘yilmaydi, lid tovari bilan qayta tasdiqlanadi.
   - «Mijoz olmadi» (`declinedAt`) — faqat joriy bron ichidagisi.
4. **Buyurtma (checkout).** Bitta buyurtma, bitta posilka, har tovar o‘z qatori; qo‘shimcha qator `is_upsell`.
   Qo‘shimcha qator narxi aynan tasdiqlangan narx bo‘lmasa — buyurtma yaratilmaydi (`PRICE_CHANGED`, TC3).
   Sayt bo‘lmagan lidda faqat `upsell` belgili qo‘shimcha qatorlar qabul qilinadi.
5. **Pul.** Qo‘shimcha qatorda ustama yo‘q; **sotuvchi haqi platformada qoladi** (ega qarori, EQ-14):
   `affiliate_fee` 0, haq `platform_service` ga qo‘shiladi. Moliya (`split.ts`) o‘zgarmadi — tenglama saqlanadi.
6. **Statistika.** `GET /operator/stats` → `upsellRate`: shu davrda tasdiqlaganlaridan qo‘shimcha tovarlilari /
   tasdiqlaganlari (TC5).

7. **Operatorga upsell bonusi** (TC6; ega qarori 2026-11-28, EQ-14):
   - har qo‘shilgan boshqa tovarga (lid qatori) bitta bonus — qatorni qo‘shgan operatorga; bitta buyurtmada 2 ta qo‘shimcha
     tovar — 2 ta bonus; o‘sha tovardan ko‘proq olish upsell emas;
   - mijoz tovarni olganda («Yetkazildi» va keyingi holatlar) yoziladi, summa — shu paytdagi sozlama; rad etilgan
     buyurtmada yo‘q; yetkazilgandan keyin qaytarilsa («Qaytmoqda») — bekor;
   - summa: `GET /admin/operator-bonus` (admin, superadmin), `PUT /admin/operator-bonus` `{ upsellBonus }` (superadmin,
     audit `operator-bonus.settings`); sukut 0 — bonus hisoblanmaydi; o‘zgartirilsa eski bonuslar o‘z summasi bilan qoladi;
   - `GET /operator/stats` → `upsellBonus` (so‘m) va `upsellBonusCount` — davrdagi bonuslar (qaytarilganlarsiz);
   - ish haqi bilan to‘lanadi (TZ 2.5) — tizim faqat hisoblaydi.

## Sozlama

| O‘zgaruvchi | Servis | Ma’nosi |
| --- | --- | --- |
| `UPSELL_WINDOW` | lead-service | 12-qoida oynasi, Toshkent vaqti, masalan `09:00-18:00` (18:00 ning o‘zi tashqarida). Bo‘sh — qoida o‘chiq (ega qarori 2026-11-28: 12-qoida qo‘llanmaydi — bo‘sh qoldiring). Noto‘g‘ri yozilsa — qo‘shish yopiq va log’da xato. |

## Migratsiyalar

- catalog `1799366400000` — `product.upsell_product_id` (FK, `ON DELETE SET NULL`, o‘zi bilan CHECK).
- lead `1799366400000` — `lead_item.is_upsell`, `added_by`, `added_at`, qisman indeks.
- lead `1799452800000` — `operator_bonus_setting` (bitta qator, sukut 0), `operator_bonus` (qator bo‘yicha bitta, `cancelled_at`).
- checkout `1799366400000` — `sales_order_item.is_upsell`.

## Ochiq savollar (egaga)

`elchi-lid-sotuv` reposi, `mvp-plan/tahlil-2026-11-28/be45/savollar.md`.
