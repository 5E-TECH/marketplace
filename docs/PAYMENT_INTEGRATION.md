# C3.2 Payme, C3.3 Click va C7.1 sinov hisoblari

Kod qismi va provayder tomonidan tasdiqlanadigan sinov alohida tekshiriladi.
Lokal testlar o'tgani sandbox checklistini avtomatik bajarilgan qilmaydi.
C7.1 uchun haqiqiy sinov hisoblari, kalitlar va ikkala provayderdagi muvaffaqiyatli to'lov dalili kerak.

## Provayderlardan nima so'rash kerak?

**Payme Business uchun yuboriladigan matn:**

> Assalomu alaykum. Elchi Marketplace uchun Payme Merchant API orqali bir martalik buyurtma to'lovini ulayapmiz. Sinov uchun merchant kabineti/web-kassa, Merchant ID (kassa ID), TEST_KEY va sandbox kirishini taqdim etishingizni so'raymiz. Hisob maydoni `account.order_id`, turi bir martalik bo'ladi. Callback URL: `https://API_DOMEN/api/v1/payments/payme/callback`. Sandbox tekshiruvi va production'ga o'tish uchun talab qilinadigan hujjatlar hamda qabul tartibini yuboring. Keyinchalik production key kerak bo'ladi.

Payme rasmiy qo'llanmasida web-kassa `key` va `TEST_KEY` berishi, sandbox uchun Merchant ID + TEST_KEY ishlatilishi ko'rsatilgan:
https://developer.help.paycom.uz/pesochnitsa/
Sandbox: https://test.paycom.uz

**Click uchun yuboriladigan matn:**

> Assalomu alaykum. Elchi Marketplace uchun Click Shop API (Prepare/Complete) ulayapmiz. Merchant kabinetiga kirish, merchant_id, service_id, secret_key hamda sinov muhiti/test to'lov tartibini taqdim etishingizni so'raymiz. Prepare URL: `https://API_DOMEN/api/v1/payments/click/prepare`; Complete URL: `https://API_DOMEN/api/v1/payments/click/complete`. `merchant_trans_id` bizning payment ID bo'ladi. Test karta/telefon yoki tester ma'lumotlarini, natijani tasdiqlash va production'ga o'tish tartibini yuboring. Agar Merchant API/refund uchun alohida merchant_user_id va ruxsat kerak bo'lsa, ularni ham taqdim eting.

Click Shop API hujjatlari: https://docs.click.uz/
Click'ning aniq test hisobi va kirish tartibini ularning texnik xodimi bilan tasdiqlang; bu repoda tashqi hisob ochilmaydi.

Biz ularga quyidagilarni beramiz: tashqaridan ochiladigan HTTPS API domeni, yuqoridagi callback URL'lar, tashkilot va mas'ul shaxs ma'lumotlari (ular so'ragan shaklda), tekshirish uchun payment ID va summa. Domen yo'lida `/api/v1` bor. Reverse proxy Basic Authorization va form-urlencoded body'ni saqlashi kerak.

## Kalitlarni loyihaga kiritish

Provayder kalitlari `.env` ga emas, SUPERADMIN JWT bilan admin endpoint orqali bazaga yoziladi.
`.env` dagi `INTEGRATION_CREDENTIAL_SECRET` — bazadagi kalitlarni shifrlash uchun loyiha kaliti. Uni almashtirish oldingi saqlangan kalitlarni ochib bo'lmasligiga olib keladi; rejalashtirilgan migratsiyasiz o'zgartirmang.

Payme: `PUT /api/v1/admin/payments/providers/PAYME`

```json
{
  "merchantId": "PAYME_KASSA_ID",
  "secret": "PAYME_TEST_KEY",
  "baseUrl": "https://test.paycom.uz",
  "isActive": true
}
```

Click: `PUT /api/v1/admin/payments/providers/CLICK`

```json
{
  "merchantId": "CLICK_MERCHANT_ID",
  "serviceId": "12345",
  "secret": "CLICK_SECRET_KEY",
  "isActive": true
}
```

`serviceId` — Click bergan service_id. Merchant ID bilan bir xil deb hisoblamang.
Imzo tekshiruviga `serviceId` va secret kiradi. `merchant_user_id` ushbu ikki callback uchun ishlatilmaydi; alohida Merchant API uchun kerak bo'lishi mumkin.
`baseUrl` saqlanadigan konfiguratsiya; callback autentifikatsiyasi tanlangan `secret` orqali ishlaydi. URL ni almashtirishning o'zi test/prod kalitini almashtirmaydi. Hozir har provayder uchun bitta faol konfiguratsiya bor: test va production'ni alohida muhit/bazalarda saqlang.

Tekshirish: `GET /api/v1/admin/payments/providers/PAYME` yoki `/CLICK`.
Javobda `configured`, `hasSecret`, `isActive`, `merchantId`, `serviceId` ko'rinadi. Secret qaytarilmaydi. `configured: true` maydonlar borligini bildiradi; provayder kalitni qabul qilganini tasdiqlamaydi.

## Sinov tartibi

1. Yangi migration'ni payment-service bazasiga qo'llang (loyihadagi migration deploy tartibi). Avval yangi checkout-service, keyin payment-service va api-gateway versiyasini deploy qiling: outbox `checkout.payment-paid` RPC'sini ishlatadi.
2. Xaridor bilan online checkout yarating. `POST /api/v1/payments` ga `salesOrderId`, `provider` (`PAYME` yoki `CLICK`) va checkout summasini yuboring. Gateway buyurtma egasi va summani checkout'dan tekshiradi.
3. Javobdagi **payment.id** ni Payme `account.order_id` yoki Click `merchant_trans_id` sifatida yuboring. Sales order ID bilan almashtirmang. Callback bir ma'noli payment ID orqali qidiradi.
4. Payme summasi **tiyin** (`125000 so'm = 12500000`), Click summasi **so'm** (`125000.00`). Click imzosi uchun yuborilgan summa satri o'zgartirilmaydi.
5. Har ssenariy uchun yangi buyurtma/to'lov ishlating. Shu buyurtmada bir provayder to'lovi kutilayotgan yoki to'langan bo'lsa, boshqa provayder tranzaksiyasi boshlanmaydi.
6. Payme: CheckPerform → Create → Perform → CheckTransaction; summa/auth xatosi; bir xil Create/Perform/Cancel takrori; Cancel oldin va keyin; GetStatement. 12 soat o'tgan pending tranzaksiya state `-1`, reason `4` bilan tugaydi. GetStatement davri provayder yuborgan `time` bo'yicha hisoblanadi.
7. Click: Prepare → Complete; noto'g'ri imzo/service ID/summa; noto'g'ri prepare ID; takror va parallel so'rov; error bilan Complete; bekor qilingandan keyin Complete rad etilishi.
8. Muvaffaqiyatli to'lov `PAID` bo'lsin, checkout qayta ishlagach buyurtma tasdiqlansin. Outbox har 10 soniyada urinadi; checkout xatosida yozuv PENDING qoladi. Texnik qayta yetkazish at-least-once; checkout tasdiqlashi idempotent.
9. Provider kabinetidagi test natijasini/sana va tranzaksiya ID sini kartaga kiriting. Kalitlarni kartaga yozmang.

Callback darajasidagi CancelTransaction payment jurnalini bekor qiladi. Buyurtma/shipment/ombor/finance bo'yicha to'liq qaytarish C3.6/C6.4 oqimlarining alohida qabul sinoviga kiradi.

## Avtomatlashtirilgan tekshiruv

```sh
npm test -- --runInBand
npx tsc --noEmit
npm run build:all
```

Haqiqiy PostgreSQL va HTTP regressiya testlari uchun **faqat alohida sinov bazasi** ishlating. Baza nomi `_payment_test` bilan tugashi shart. Testlar `payment` sxemasidagi to'lov/config/outbox jadvallarini tozalaydi.

```sh
PAYMENT_TEST_DATABASE_URL=postgresql://TEST_USER:TEST_PASSWORD@127.0.0.1:5432/marketplace_payment_test npm run test:payment:integration
```

Bu testlar haqiqiy PostgreSQL tranzaksiyalari, parallel so'rov, rollback, provider ID ajratilishi, timeout, outbox retry, shifrlash va HTTP Basic/form-urlencoded hamda ruxsatlarni tekshiradi. Broker/provayder javoblari testda boshqariladi; bu tashqi sandbox sinovi emas.

Butun Jest to'plamini PostgreSQL/HTTP testlari bilan birga bajarish uchun shu komandaga `-- --all` qo'shing. Bu holatda inventory integratsion testlari ham sinov bazasining `inventory` sxemasida ishlaydi.

2026-09-08 lokal tekshiruv: **98 suite, 408 test — hammasi o'tdi, skip yo'q**. `tsc --noEmit`, ESLint, Prettier va barcha servislar build'i tekshirildi. OpenAPI yangilandi. Tashqi Payme/Click sandbox sinovi hali bajarilmadi.

## Done mezoni

- C3.2/C3.3: kod + lokal testlar + provayder sandbox checklisti va to'lov dalili.
- C7.1: ikkala hisob/kalit olingan + konfiguratsiya saqlangan + har ikkala provayderda yakuniy sinov o'tgan.
- Tashqi hisoblar va sinov dalili bo'lmasa, kartalarni Done qilish uchun barcha talablar bajarilgan deb hisoblanmaydi.

## Migratsiya va ishlash cheklovi

Yangi migration eski Click `merchant_id` qiymatini `service_id` ga ko'chiradi, chunki avvalgi kod shu maydonni service ID sifatida ishlatgan. So'ng haqiqiy merchant ID ni admin endpoint orqali yangilang. Payme/Click tranzaksiya ID'lari endi provider doirasida unique; eski formatga rollback cross-provider ID to'qnashuvi bo'lsa xavfsiz xato bilan to'xtaydi.

Callback yozuvlari MVP uchun umumiy PostgreSQL advisory lock bilan ketma-ketlashtiriladi. Bu bir nechta service nusxasida ham ishlaydi; katta to'lov oqimida lock doirasini toraytirish alohida performance ishidir.
