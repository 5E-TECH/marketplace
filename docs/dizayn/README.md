# Marketplace dizayn shabloni

Elchi Marketplace’ni lid-sotuv modeliga o‘tkazish uchun tayyorlangan yangi dizayn. Ega 2026-11-04 da yakuniy **E** variantini ma’qullagan: C tuzilishi, A ranglari va shrifti, B narx tasdiqlash sahifasi. Hamma ekranlarni E uslubida chizish hali boshlanmagan.

## Ichida nima bor

| Yo‘l | Nima |
| --- | --- |
| [`final-brief.md`](final-brief.md) | E ning qoidalari: qaysi qism qaysi variantdan olingani |
| [`brend-qoidalari.md`](brend-qoidalari.md) | Ranglar, shrift, o‘lchamlar, komponentlar, belgilar va logotip tavsifi |
| [`ekranlar/yakuniy-E/`](ekranlar/yakuniy-E/) | E: dizayn tizimi taxtasi, landing, «rahmat», operator ish joyi, sotuvchi kabineti |
| [`ekranlar/variantlar-A-D/`](ekranlar/variantlar-A-D/) | Solishtirilgan A–D variantlari, faqat ma’lumot uchun |
| [`assets/`](assets/) | Logo book va logotip fayllari |

## Fayllarni ochish

`.dc.html` fayllar Claude Design canvas’ining manba fayllari. Ulardagi rasmlar canvas ichidagi `/_blob/...` manzilidan olinadi, shuning uchun canvasdan tashqarida ko‘rinmaydi. To‘liq ko‘rinish canvasda: <https://claude.ai/artifact/5GrVSxfoXBwgPUzCREQb6y> (hozircha faqat ega ochadi).

## Bu papkada nima yo‘q

Bu repo ochiq, shuning uchun ichki hisob-kitob va biznes hujjatlari bu yerga qo‘yilmagan. Ular private repoda turadi: `Shodiyor-Ergashev/elchi-lid-sotuv`. Kirish uchun egaga murojaat qiling.

- Admin narx tasdiqlash ekranlari (`*-Admin-narx`, `*-Admin-qaror`).
- `content-spec.md`, `variants.md`, `code-constraints.md`, `DAVOM.md` va canvas sozlamasi (`canvas.json`). `final-brief.md` dagi havolalar shu fayllarga ham ishora qiladi.
- TZ, tahlil va investor hujjatlari.

`E-Tizim.dc.html` canvasdagi nusxadan farq qiladi: narx chegaralari `[chegara]`, admin hisobidagi qiymatlar `[summa]` bilan almashtirilgan.

Bu papkaga narx formulalari, xarajat yoki marja raqamlari va investor ma’lumotlarini qo‘shmang.

## Eski hujjat bilan farq

[`../DESIGN_TZ.md`](../DESIGN_TZ.md) 2026-07 dagi qoralama: u eski sotuvchi kabineti uchun yozilgan va asosiy rangi `#7C3AED`. E qoidalari esa binafsha rangni taqiqlaydi, shuning uchun yangi ekranlarni shu papkadagi qoidalar bo‘yicha chizing.
