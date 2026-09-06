// Backend auditida topilgan bo'shliqlar. Hammasi admin panelining kengaytmasi —
// MVP uchun shart emas, shuning uchun 15-sentabrdan keyin.
export default [
{ code:'C6.1', name:"C6.1 Admin: jamoa boshqaruvi (admin/team)", member:'Dilshodbek',
  labels:'Phase 4;Backend-Core;Normal;M', due:'2026-09-17',
  desc:`**Maqsad:** Platforma egasi o'z jamoasini — admin va moderatorlarni — tizim ichida boshqara olsin.

**Oddiy tilda:** hozir yangi admin qo'shish uchun bazaga qo'lda kirish kerak. Bu xavfli va noqulay. Bosh admin panel orqali xodim qo'shishi, uning rolini o'zgartirishi va ketganida o'chirishi kerak.

**Nega kerak:** jamoa o'sganda kim nimaga ruxsatli ekanini nazorat qilib bo'lmay qoladi. Ketgan xodimning kirishi ochiq qolishi esa jiddiy xavf.

**Ishlar:**
- \`GET /admin/team\` — jamoa ro'yxati
- \`POST /admin/team\` — yangi a'zo qo'shish
- \`PATCH /admin/team/:id/role\` — rolini o'zgartirish
- \`DELETE /admin/team/:id\` — a'zoni o'chirish
- Faqat SUPERADMIN bajara olishi
- Har o'zgarish audit jurnaliga tushishi

**Tayyor deb hisoblanadi:** SUPERADMIN a'zo qo'shadi, rolini o'zgartiradi va o'chiradi; oddiy ADMIN bularni qila olmaydi.`,
  tests:["TC1 SUPERADMIN jamoa ro'yxatini oladi","TC2 yangi a'zo qo'shiladi va kira oladi","TC3 rol o'zgartirilganda ruxsatlar ham o'zgaradi","TC4 oddiy ADMIN uchun 403 qaytadi","TC5 har amal audit jurnalida ko'rinadi"] },

{ code:'C6.2', name:"C6.2 Admin: platforma sozlamalari (admin/settings)", member:'Dilshodbek',
  labels:'Phase 4;Backend-Core;Normal;S', due:'2026-09-18',
  desc:`**Maqsad:** Platforma sozlamalarini kod o'zgartirmasdan, panel orqali boshqarish.

**Oddiy tilda:** komissiya foizi, minimal buyurtma summasi, aloqa telefoni kabi qiymatlar hozir kodda yoki \`.env\` faylda turibdi. Ularni o'zgartirish uchun har safar dasturchi kerak va deploy qilish kerak. Panel orqali o'zgartirilsa, biznes o'zi boshqaradi.

**Ishlar:**
- \`GET /admin/settings\` — joriy sozlamalar
- \`PUT /admin/settings\` — o'zgartirish
- Qiymatlarni tekshirish (masalan komissiya 0-100 oralig'ida)
- Faqat SUPERADMIN o'zgartira olishi
- O'zgarishlar audit jurnaliga

**Tayyor deb hisoblanadi:** sozlama panel orqali o'zgaradi va tizim darhol yangi qiymatni ishlatadi.`,
  tests:["TC1 sozlamalar ro'yxati qaytadi","TC2 o'zgartirilgan qiymat saqlanadi","TC3 noto'g'ri qiymat rad etiladi","TC4 oddiy ADMIN o'zgartira olmaydi"] },

{ code:'C6.3', name:"C6.3 Admin: audit jurnalini ko'rish (admin/audit)", member:'Dilshodbek',
  labels:'Phase 4;Backend-Core;High;S', due:'2026-09-16',
  desc:`**Maqsad:** Admin kim nima qilganini ko'ra olsin.

**Oddiy tilda:** tizimda muhim amallar allaqachon yozib borilyapti (C1.31) — kim do'konni to'xtatgan, kim narxni o'zgartirgan. Lekin bu yozuvlarni **ko'rish** imkoni yo'q, ular faqat bazada yotibdi.

**Nega kerak:** nizo chiqqanda ("men bunday qilmadim") yoki xato yuz berganda kim, qachon, nima qilganini aniqlash kerak bo'ladi. Yozuv bor-u, ko'rib bo'lmasa foydasi yo'q.

**Ishlar:**
- \`GET /admin/audit\` — jurnal ro'yxati, sahifalash bilan
- Filtr: kim, qaysi amal, qaysi sana
- Har yozuvda: kim, qachon, nima qildi, qaysi obyektga
- Faqat ADMIN va SUPERADMIN ko'ra olishi

**Tayyor deb hisoblanadi:** jurnal ro'yxati chiqadi va filtrlar ishlaydi.`,
  tests:["TC1 audit yozuvlari ro'yxati qaytadi","TC2 foydalanuvchi bo'yicha filtr ishlaydi","TC3 sana bo'yicha filtr ishlaydi","TC4 oddiy foydalanuvchi uchun 403"] },

{ code:'C6.4', name:"C6.4 Admin: buyurtmani bekor qilish va pul qaytarish", member:'Dilshodbek',
  labels:'Phase 4;Backend-Commerce;High;M', due:'2026-09-19',
  desc:`**Maqsad:** Admin muammoli buyurtmani bekor qilib, to'langan pulni qaytara olsin.

**Oddiy tilda:** xaridor to'ladi, lekin tovar yo'q chiqdi yoki sotuvchi javob bermayapti. Admin aralashib buyurtmani bekor qiladi va pulni qaytaradi. Hozir bekor qilish bor, **pul qaytarish yo'q**.

**Ehtiyot bo'lish kerak:** pul qaytarish faqat bir marta bajarilishi shart. Takroriy so'rov kelsa ikkinchi marta qaytarilmasligi kerak — aks holda platforma zarar ko'radi.

**Ishlar:**
- \`POST /admin/orders/:id/refund\` — pul qaytarish
- To'lov tizimiga (Payme/Click) qaytarish so'rovi
- Takroriy so'rovni ikki marta bajarmaslik
- Qoldiqni omborga qaytarish
- Sotuvchi hisobidan yechish (finance)
- Xaridor va sotuvchiga xabar

**Tayyor deb hisoblanadi:** to'langan buyurtma qaytariladi, pul qaytadi, qoldiq tiklanadi va takroriy so'rov ikkinchi marta ishlamaydi.`,
  tests:["TC1 to'langan buyurtma uchun pul qaytariladi","TC2 takroriy so'rov ikkinchi marta qaytarmaydi","TC3 qoldiq omborga tiklanadi","TC4 to'lanmagan buyurtmada tushunarli xato","TC5 sotuvchi hisobidan yechiladi"] },

{ code:'C6.5', name:"C6.5 Admin: foydalanuvchi roli va nomidan kirish", member:'Dilshodbek',
  labels:'Phase 4;Backend-Core;Normal;M', due:'2026-09-22',
  desc:`**Maqsad:** Admin foydalanuvchi rolini o'zgartira olsin va muammoni tekshirish uchun uning nomidan kira olsin.

**Oddiy tilda:** ikkita imkoniyat. Birinchisi — oddiy xaridorni sotuvchiga aylantirish yoki teskarisi. Ikkinchisi — foydalanuvchi "menda ishlamayapti" deganda admin uning ko'zi bilan ko'rib, muammoni aniqlashi.

**Xavfsizlik:** birovning nomidan kirish kuchli imkoniyat. Har bunday kirish albatta jurnalga yozilishi va vaqti cheklangan bo'lishi kerak. Aks holda suiiste'mol qilinadi.

**Ishlar:**
- \`PATCH /admin/users/:id/role\` — rolni o'zgartirish
- \`POST /admin/users/:id/impersonate\` — nomidan kirish (vaqtinchalik token)
- Faqat SUPERADMIN nomidan kira olishi
- Har kirish jurnalga yozilishi
- Token muddati qisqa (masalan 15 daqiqa)

**Tayyor deb hisoblanadi:** rol o'zgaradi va ruxsatlar darhol ta'sir qiladi; nomidan kirish jurnalga tushadi va muddati tugaydi.`,
  tests:["TC1 rol o'zgartirilganda ruxsatlar ham o'zgaradi","TC2 nomidan kirish tokeni ishlaydi","TC3 token muddati tugagach ishlamaydi","TC4 har kirish jurnalga yoziladi","TC5 oddiy ADMIN nomidan kira olmaydi"] },

{ code:'C6.6', name:"C6.6 Admin: do'kon va mahsulotni ko'rinishdan boshqarish", member:'Dilshodbek',
  labels:'Phase 4;Backend-Commerce;Normal;S', due:'2026-09-23',
  desc:`**Maqsad:** Admin do'konni bosh sahifada ko'rsata olsin yoki alohida mahsulotni yashira olsin.

**Oddiy tilda:** ikkita ish. Birinchisi — yaxshi ishlayotgan do'konni bosh sahifada oldinga chiqarish (tavsiya etilgan). Ikkinchisi — qoidaga zid mahsulotni butun do'konni yopmasdan yashirish.

Hozir faqat butun do'konni to'xtatish bor — bu juda qo'pol chora, bitta mahsulot uchun butun do'kon jazolanadi.

**Ishlar:**
- \`POST /admin/shops/:id/feature\` — do'konni tavsiya etilganga qo'shish/olib tashlash
- \`POST /admin/products/:id/hide\` — mahsulotni yashirish
- Yashirilgan mahsulot do'kondan ham, qidiruvdan ham yo'qolishi
- Sotuvchiga sabab bilan xabar
- Amallar jurnalga

**Tayyor deb hisoblanadi:** yashirilgan mahsulot saytdan yo'qoladi, tavsiya etilgan do'kon bosh sahifada chiqadi.`,
  tests:["TC1 yashirilgan mahsulot storefrontda ko'rinmaydi","TC2 yashirilgan mahsulot qidiruvda chiqmaydi","TC3 tavsiya belgisi qo'yiladi va olinadi","TC4 sotuvchiga xabar boradi"] },

{ code:'C6.7', name:"C6.7 Admin: qoldiq va Elchi integratsiyasi ko'rinishi", member:'Dilshodbek',
  labels:'Phase 4;Backend-Core;Normal;M', due:'2026-09-24',
  desc:`**Maqsad:** Admin butun platforma bo'yicha qoldiq va yetkazib berish holatini bir joydan ko'rsin.

**Oddiy tilda:** hozir har sotuvchi faqat o'z qoldig'ini ko'radi. Admin esa umumiy manzarani ko'ra olmaydi — qaysi tovar tugab qolgan, qaysi posilka yo'lda qotib qolgan.

**Nega kerak:** xaridor "buyurtmam qani?" deb qo'ng'iroq qilganda admin javob bera olishi kerak. Hozir buning uchun bazaga qarash kerak.

**Ishlar:**
- \`GET /admin/inventory/stock\` — barcha sotuvchilar qoldig'i
- \`GET /admin/inventory/movements\` — qoldiq harakati jurnali
- \`GET /admin/integration/shipments\` — Elchi posilkalari ro'yxati
- \`GET /admin/integration/webhooks\` — Elchi xabarlari tarixi
- \`POST /admin/integration/shops/:id/reprovision\` — do'konni Elchi'da qayta ro'yxatdan o'tkazish
- Filtr va sahifalash

**Tayyor deb hisoblanadi:** admin barcha qoldiq va posilkalarni ko'radi, muammoli do'konni qayta ro'yxatdan o'tkaza oladi.`,
  tests:["TC1 barcha sotuvchilar qoldig'i ro'yxati qaytadi","TC2 qoldiq harakati jurnali ko'rinadi","TC3 Elchi posilkalari ro'yxati qaytadi","TC4 webhook tarixi ko'rinadi","TC5 qayta ro'yxatdan o'tkazish ishlaydi"] },

{ code:'C6.8', name:"C6.8 Admin: xabar shablonlari va ommaviy xabar", member:'Dilshodbek',
  labels:'Phase 4;Backend-Core;Normal;M', due:'2026-09-25',
  desc:`**Maqsad:** Admin foydalanuvchilarga yuboriladigan xabarlar matnini boshqara olsin va ommaviy xabar yubora olsin.

**Oddiy tilda:** tizim avtomatik xabar yuboradi — "buyurtmangiz qabul qilindi", "posilka yo'lda". Bu matnlar hozir kodda yozilgan, o'zgartirish uchun dasturchi kerak. Panel orqali tahrirlansa qulay.

Ommaviy xabar esa alohida ish: aksiya yoki muhim e'lonni hamma foydalanuvchiga bir vaqtda yuborish.

**Ehtiyot bo'lish kerak:** ommaviy xabar kuchli qurol. Xato yuborilsa qaytarib bo'lmaydi, shuning uchun oldindan ko'rish va tasdiqlash bosqichi bo'lishi kerak.

**Ishlar:**
- \`GET /admin/notifications/templates\` — shablonlar ro'yxati
- Shablonni tahrirlash
- \`POST /admin/broadcast\` — ommaviy xabar
- Qabul qiluvchilarni tanlash (hamma / sotuvchilar / xaridorlar)
- Yuborishdan oldin oldindan ko'rish
- Faqat SUPERADMIN yubora olishi

**Tayyor deb hisoblanadi:** shablon tahrirlanadi va ommaviy xabar tanlangan guruhga boradi.`,
  tests:["TC1 shablonlar ro'yxati qaytadi","TC2 tahrirlangan shablon yangi xabarlarda ishlatiladi","TC3 ommaviy xabar tanlangan guruhga boradi","TC4 oddiy ADMIN ommaviy xabar yubora olmaydi"] },

{ code:'C6.9', name:"C6.9 Admin: bosh sahifa bannerlari", member:'Dilshodbek',
  labels:'Phase 4;Backend-Commerce;Normal;S', due:'2026-09-26',
  desc:`**Maqsad:** Admin bosh sahifadagi reklama bannerlarini o'zi boshqara olsin.

**Oddiy tilda:** do'kon bosh sahifasida aksiya bannerlari bo'ladi — "50% chegirma", "yangi kolleksiya". Ularni qo'yish uchun har safar dasturchi kerak bo'lmasligi kerak.

**Ishlar:**
- Banner qo'shish: rasm, sarlavha, havola
- Bannerlar ro'yxati va tartibini o'zgartirish
- \`DELETE /admin/content/banners/:id\` — o'chirish
- Faol/nofaol holati va ko'rsatish muddati
- Storefront uchun faol bannerlarni beruvchi endpoint

**Tayyor deb hisoblanadi:** admin banner qo'shadi va u bosh sahifada chiqadi; muddati tugaganda o'zi yo'qoladi.`,
  tests:["TC1 banner qo'shiladi va ro'yxatda ko'rinadi","TC2 storefront faol bannerlarni oladi","TC3 muddati tugagan banner ko'rinmaydi","TC4 o'chirilgan banner yo'qoladi"] },
];
