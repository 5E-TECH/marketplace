// Qo'lda (odam bajaradigan) qabul testlari. Har qadam: NIMA QILASIZ -> NIMA CHIQISHI KERAK.
const HEAD = `> **BU TEST QO'LDA BAJARILADI.** Avtomatik testlar o'tgani yetarli emas —
> haqiqiy brauzerda, haqiqiy ma'lumot bilan o'zingiz bosib ko'rasiz.
> Har qadamdan keyin natija kutilganidek chiqqanini tekshiring. Bitta qadam
> mos kelmasa — card Done'ga o'tmaydi, xato topilib tuzatiladi.\n\n`;

export default [
{ code:'C8.1', name:"C8.1 QO'LDA TEST: MVP — xaridor buyurtma bera oladimi", member:'Lead',
  labels:"Qo'lda test;Blocker;M", due:'2026-09-15', mvp:true,
  desc:HEAD+`**Maqsad:** 15-sentabrda ishga tushirishdan oldin eng asosiy savolga javob berish — begona odam saytga kirib, haqiqatan buyurtma bera oladimi?

Bu testni **hech narsa bilmaydigan odam** bajarsa yaxshi bo'ladi. Agar u yo'l davomida "endi nima qilaman?" deb to'xtab qolsa — bu topilma, tuzatish kerak.

**Qadamlar:**

1. Brauzerda domen manzilini oching (telefon yoki noutbukdan)
   → Mahsulotlar ro'yxati ochilishi kerak. Bo'sh ekran yoki "yuklanmoqda" da qotib qolmasligi kerak.

2. Manzil qatoriga qarang
   → \`https://\` bo'lishi va qulf belgisi turishi kerak. "Xavfsiz emas" yozuvi bo'lmasligi kerak.

3. Bitta mahsulotni bosing
   → Mahsulot sahifasi ochiladi: rasm, nom, narx, tavsif ko'rinadi.

4. "Savatga qo'shish" tugmasini bosing
   → Tepadagi savat belgisida son 1 ga o'zgaradi.

5. Savatga kiring
   → Qo'shilgan mahsulot, narxi va jami summa to'g'ri ko'rinadi.

6. "Buyurtma berish" tugmasini bosing va formani to'ldiring (ism, telefon, manzil)
   → Yetkazib berish narxi hisoblanib chiqadi, jami summa yangilanadi.

7. Buyurtmani tasdiqlang
   → "Buyurtmangiz qabul qilindi" degan sahifa va buyurtma raqami chiqadi.

8. Endi sotuvchi kabinetiga kiring (\`admin.<domen>\`) va Buyurtmalar bo'limini oching
   → Hozirgina berilgan buyurtma ro'yxatda turishi kerak, to'g'ri summa va mahsulot bilan.

**MUHIM:** 1–8 qadamlarni **ro'yxatdan o'tmasdan** bajaring. Agar biror joyda tizim ro'yxatdan o'tishga majbur qilsa — bu xato, chunki mehmon buyurtmasi ishlashi kerak.

**Tayyor deb hisoblanadi:** sakkizala qadam ham kutilganidek o'tadi va buyurtma kabinetda ko'rinadi.`,
  tests:["TC1 sayt HTTPS bilan ochiladi va mahsulotlar ko'rinadi","TC2 mahsulot sahifasi to'liq ochiladi","TC3 savatga qo'shish ishlaydi va son o'zgaradi","TC4 yetkazish narxi hisoblanadi","TC5 buyurtma tasdiqlanadi va raqam beriladi","TC6 buyurtma sotuvchi kabinetida ko'rinadi","TC7 butun yo'l ro'yxatdan o'tmasdan o'tadi"] },

{ code:'C8.2', name:"C8.2 QO'LDA TEST: xaridor yo'li — to'liq", member:'Dilshodbek',
  labels:"Qo'lda test;High;M", due:'2026-09-28',
  desc:HEAD+`**Maqsad:** Xaridor qiladigan barcha ishni tekshirish, faqat buyurtma berishni emas.

**Kim tekshiradi:** bu qismni Bahodir yozgan, shuning uchun Dilshodbek tekshiradi. Yozgan odam o'z xatosini ko'rmaydi.

**Qadamlar:**

1. Qidiruv maydoniga mahsulot nomini yozing
   → Tegishli mahsulotlar chiqadi. Mavjud bo'lmagan so'z yozsangiz — "topilmadi" degan tushunarli xabar, bo'sh ekran emas.

2. Kategoriyani tanlang
   → Faqat o'sha turdagi mahsulotlar qoladi.

3. Narx bo'yicha saralang
   → Tartib o'zgaradi. Sahifani yangilasangiz ham saralash saqlanib qoladi.

4. Mahsulot sahifasida do'kon nomini bosing
   → Do'kon sahifasi ochiladi, faqat o'sha do'kon mahsulotlari ko'rinadi.

5. Mahsulotdagi yurakcha belgisini bosing, keyin "Sevimlilar" bo'limiga kiring
   → Belgilangan mahsulot ro'yxatda turadi.

6. Ro'yxatdan o'ting (telefon va parol bilan)
   → Kirish muvaffaqiyatli, ismingiz tepada ko'rinadi.

7. Kirishdan **oldin** savatga solgan mahsulot hali savatdami tekshiring
   → Mahsulot yo'qolmagan bo'lishi kerak. Bu muhim: mehmon savati akkauntga qo'shilishi shart.

8. "Mening buyurtmalarim" bo'limini oching
   → Avval bergan buyurtmangiz ro'yxatda turadi, holati bilan.

9. Sotib olingan mahsulotga sharh yozing
   → Sharh saqlanadi va mahsulot sahifasida ko'rinadi. Sotib olmagan mahsulotga sharh yozib ko'ring — ruxsat berilmasligi kerak.

**Tayyor deb hisoblanadi:** to'qqizala qadam ham ishlaydi, ayniqsa 7-qadam (savat yo'qolmasligi).`,
  tests:["TC1 qidiruv ishlaydi, topilmaganda tushunarli xabar","TC2 kategoriya va saralash ishlaydi","TC3 do'kon sahifasi faqat o'z mahsulotlarini ko'rsatadi","TC4 sevimlilar saqlanadi","TC5 kirgandan keyin mehmon savati yo'qolmaydi","TC6 mening buyurtmalarim ro'yxati to'g'ri","TC7 faqat sotib olgan sharh yoza oladi"] },

{ code:'C8.3', name:"C8.3 QO'LDA TEST: sotuvchi yo'li — ro'yxatdan sotuvgacha", member:'Dilshodbek',
  labels:"Qo'lda test;High;M", due:'2026-09-28',
  desc:HEAD+`**Maqsad:** Yangi sotuvchi noldan boshlab mahsulot sotadigan holatga kela oladimi.

**Yangi telefon raqami bilan boshlang** — eski akkaunt bilan sinash haqiqiy manzarani ko'rsatmaydi.

**Qadamlar:**

1. Kabinetga kirib sotuvchi bo'lib ro'yxatdan o'ting
   → Ro'yxat qabul qilinadi, lekin do'kon hali ishlamaydi ("tekshiruvda" holati).

2. Admin bilan kirib, o'sha do'konni tasdiqlang
   → Do'kon holati "faol" ga o'zgaradi.

3. Sotuvchi bo'lib qayta kiring
   → Endi mahsulot qo'shish bo'limlari ochiq bo'ladi.

4. Ombor qo'shing va uni asosiy qilib belgilang
   → Ombor ro'yxatda ko'rinadi, "asosiy" belgisi turadi.

5. Mahsulot qo'shing: nom, narx, tavsif, kamida bitta rasm
   → Mahsulot saqlanadi va ro'yxatda chiqadi. Rasm ochilishi kerak.

6. Mahsulotga variant qo'shing (masalan ikkita o'lcham, har xil narx)
   → Variantlar saqlanadi.

7. Qoldiq bo'limiga kirib kirim qiling (masalan +10)
   → Qoldiq 10 ga o'zgaradi.

8. Endi **xaridor sifatida** do'konni oching
   → Yangi qo'shilgan mahsulot saytda ko'rinadi va sotib olish mumkin.

9. Xaridor buyurtma bergandan keyin sotuvchi kabinetiga qayting
   → Buyurtma ro'yxatda, holatini o'zgartirish mumkin.

10. Buyurtmani yetkazib berishga topshiring
    → Elchi jo'natmasi yaratiladi, kuzatuv havolasi paydo bo'ladi.

**Tayyor deb hisoblanadi:** o'nala qadam ham o'tadi va yangi sotuvchi haqiqatan sota boshlaydi.`,
  tests:["TC1 ro'yxatdan o'tgan do'kon tasdiqlanmaguncha ishlamaydi","TC2 admin tasdiqlagach ochiladi","TC3 ombor va asosiy belgisi ishlaydi","TC4 mahsulot va rasm saqlanadi","TC5 variantlar saqlanadi","TC6 qoldiq kirimi to'g'ri hisoblanadi","TC7 mahsulot saytda ko'rinadi","TC8 buyurtma kabinetga tushadi","TC9 Elchi jo'natmasi yaratiladi"] },

{ code:'C8.4', name:"C8.4 QO'LDA TEST: admin paneli", member:'Lead',
  labels:"Qo'lda test;High;M", due:'2026-09-29',
  desc:HEAD+`**Maqsad:** Admin platformani haqiqatan boshqara oladimi.

**Qadamlar:**

1. Admin bo'lib kiring
   → Admin bo'limlari ko'rinadi. Sotuvchi menyulari ko'rinmasligi kerak.

2. Do'konlar ro'yxatini oching, kutayotgan do'konni tasdiqlang
   → Holat o'zgaradi, do'kon saytda paydo bo'ladi.

3. Boshqa do'konni to'xtating (suspend)
   → Uning mahsulotlari saytdan **darhol** yo'qolishi kerak. Tekshiring: xaridor sifatida qidirib ko'ring.

4. Foydalanuvchilar bo'limida birovni bloklang
   → O'sha odam kira olmaydi. Chiqib, uning akkaunti bilan kirib ko'ring.

5. Buyurtmalar bo'limini oching
   → Barcha sotuvchilarning buyurtmalari ko'rinadi, filtrlash ishlaydi.

6. Kategoriya qo'shing
   → Yangi kategoriya saytda paydo bo'ladi.

7. Moliya bo'limini oching
   → Aylanma, komissiya va to'lovlar ko'rinadi. Raqamlar mantiqan to'g'ri bo'lishi kerak (buyurtmalar summasiga mos).

8. Audit jurnalini oching
   → Yuqorida qilgan amallaringiz (tasdiqlash, to'xtatish, bloklash) ro'yxatda turishi kerak — kim, qachon, nima qilgani bilan.

**Tayyor deb hisoblanadi:** sakkizala qadam ham ishlaydi, ayniqsa 3-qadam (to'xtatilgan do'kon mahsulotlari yo'qolishi) va 8-qadam (jurnal).`,
  tests:["TC1 admin faqat o'z bo'limlarini ko'radi","TC2 do'kon tasdiqlanadi va saytda chiqadi","TC3 to'xtatilgan do'kon mahsulotlari saytdan yo'qoladi","TC4 bloklangan foydalanuvchi kira olmaydi","TC5 buyurtmalar va filtr ishlaydi","TC6 moliya raqamlari mantiqan to'g'ri","TC7 audit jurnalida amallar ko'rinadi"] },

{ code:'C8.5', name:"C8.5 QO'LDA TEST: operator va ruxsatlar chegarasi", member:'Lead',
  labels:"Qo'lda test;High;S", due:'2026-09-29',
  desc:HEAD+`**Maqsad:** Har rol faqat o'ziga tegishli ishni qila olishini tekshirish. Bu xavfsizlik masalasi.

**Qadamlar:**

1. Sotuvchi bo'lib kirib, operator qo'shing
   → Operator yaratiladi.

2. Operator bo'lib kiring
   → Faqat buyurtmalar va yetkazib berish bo'limlari ko'rinadi. Mahsulot, ombor, do'kon profili **ko'rinmasligi** kerak.

3. Operator sifatida mahsulotlar manzilini brauzerga qo'lda yozing (\`/products\`)
   → "Ruxsat yo'q" degan holat chiqishi kerak. Sahifa ochilib qolmasligi kerak.

4. Xaridor (BUYER) akkaunti bilan kabinetga kiring
   → Kabinetga umuman kira olmasligi kerak.

5. Sotuvchi A bilan kirib, sotuvchi B ning buyurtma raqamini manzilga yozing
   → Boshqa sotuvchining buyurtmasi ko'rinmasligi kerak.

6. Oddiy admin bilan kirib, SUPERADMIN bo'limlarini (jamoa, sozlamalar) oching
   → Ruxsat berilmasligi kerak.

**Tayyor deb hisoblanadi:** oltala qadam ham to'sadi. Birortasi ochilib qolsa — bu jiddiy xavfsizlik xatosi, darhol tuzatiladi.`,
  tests:["TC1 operator faqat buyurtma bo'limlarini ko'radi","TC2 operator mahsulot sahifasiga kira olmaydi","TC3 BUYER kabinetga kira olmaydi","TC4 sotuvchi boshqa sotuvchi buyurtmasini ko'rmaydi","TC5 oddiy admin SUPERADMIN bo'limlariga kira olmaydi"] },

{ code:'C8.6', name:"C8.6 QO'LDA TEST: to'lov", member:'Bahodir',
  labels:"Qo'lda test;High;M", due:'2026-09-28',
  desc:HEAD+`**Maqsad:** Pul haqiqatan o'tadimi va har holatda tizim to'g'ri javob beradimi.

**Kim tekshiradi:** bu qismni Dilshodbek yozgan, shuning uchun Bahodir tekshiradi.

**Sinov kartasidan foydalaning** — haqiqiy pul ishlatmang.

**Qadamlar:**

1. Buyurtma bering va "karta bilan to'lash" ni tanlang
   → Payme yoki Click sahifasiga o'tasiz.

2. Sinov kartasi bilan to'lang
   → Saytga qaytasiz, "to'lov muvaffaqiyatli" degan sahifa chiqadi.

3. Buyurtma holatini tekshiring
   → "To'langan" deb ko'rinishi kerak.

4. Yangi buyurtma bering, to'lov sahifasida **bekor qiling**
   → Saytga qaytganda "to'lov bekor qilindi" chiqadi, buyurtma to'lanmagan bo'lib qoladi.

5. Yangi buyurtma bering va to'lov sahifasini **shunchaki yoping**
   → Buyurtmaga qaytganingizda holat tushunarli bo'lishi kerak, "muzlab" qolmasligi.

6. Ikkinchi to'lov turini (COD — qo'lga to'lash) sinab ko'ring
   → Buyurtma yaratiladi, to'lov "yetkazib berilganda" deb belgilanadi.

7. Admin bo'lib to'langan buyurtmani qaytaring (refund)
   → Pul qaytariladi, buyurtma holati o'zgaradi. **Ikkinchi marta qaytarishga urinib ko'ring** — ikki marta qaytarilmasligi kerak.

**Tayyor deb hisoblanadi:** yettala holat ham to'g'ri ishlaydi, ayniqsa 7-qadam (takroriy qaytarish bo'lmasligi).`,
  tests:["TC1 sinov kartasi bilan to'lov o'tadi","TC2 buyurtma to'langan holatiga o'tadi","TC3 bekor qilingan to'lov to'g'ri ko'rsatiladi","TC4 to'lov oynasi yopilganda holat tushunarli","TC5 COD buyurtmasi ishlaydi","TC6 refund pul qaytaradi","TC7 takroriy refund ikki marta qaytarmaydi"] },

{ code:'C8.7', name:"C8.7 QO'LDA TEST: Elchi yetkazib berish", member:'Dilshodbek',
  labels:"Qo'lda test;High;M", due:'2026-09-29',
  desc:HEAD+`**Maqsad:** Buyurtma haqiqatan Elchi tizimiga tushadimi va holat qaytib keladimi.

**Qadamlar:**

1. Buyurtma bering va sotuvchi bo'lib uni yetkazib berishga topshiring
   → Elchi jo'natmasi yaratiladi, jo'natma raqami paydo bo'ladi.

2. Elchi tizimiga kirib o'sha jo'natmani toping
   → Buyurtma u yerda ko'rinishi kerak: manzil, mahsulotlar, undiriladigan summa to'g'ri.

3. Elchi tomonda jo'natma holatini o'zgartiring (masalan "yo'lda")
   → Bir necha soniyadan keyin marketplace'da ham holat o'zgarishi kerak. Sahifani yangilab tekshiring.

4. Xaridor sifatida buyurtma kuzatuv havolasini oching
   → Joriy holat ko'rinadi.

5. Yetkazib berilmagan jo'natmani bekor qiling
   → Bekor qilinadi, buyurtma holati o'zgaradi.

6. Endi **yetkazib berilgan** jo'natmani bekor qilishga urinib ko'ring
   → Ruxsat berilmasligi kerak, tushunarli xato chiqishi kerak.

7. Turli do'kondan ikkita mahsulot bilan buyurtma bering
   → Ikkita alohida jo'natma yaratilishi va har biriga alohida yetkazish narxi hisoblanishi kerak.

**Tayyor deb hisoblanadi:** yettala qadam ham ishlaydi, ayniqsa 3-qadam (holat qaytib kelishi) va 7-qadam (ko'p do'konli buyurtma).`,
  tests:["TC1 jo'natma Elchi'da yaratiladi","TC2 ma'lumotlar to'g'ri uzatiladi","TC3 Elchi'dagi holat marketplace'ga qaytadi","TC4 xaridor kuzatuvni ko'radi","TC5 bekor qilish ishlaydi","TC6 yetkazilganni bekor qilib bo'lmaydi","TC7 ko'p do'konli buyurtma alohida jo'natmaga bo'linadi"] },

{ code:'C8.8', name:"C8.8 QO'LDA TEST: telefonda ishlashi", member:'Bahodir',
  labels:"Qo'lda test;High;S", due:'2026-09-29',
  desc:HEAD+`**Maqsad:** Xaridorlarning ko'pchiligi telefondan kiradi — sayt o'sha yerda ishlashi kerak.

**Haqiqiy telefondan tekshiring**, brauzerni kichraytirish yetarli emas.

**Qadamlar:**

1. Telefonda saytni oching
   → Sahifa ekranga sig'adi. Yon tomonga surish kerak bo'lmasligi kerak.

2. Butun xaridor yo'lini telefondan bajaring: mahsulot topish → savat → buyurtma
   → Har qadam ishlaydi, tugmalar barmoq bilan bosiladigan kattalikda.

3. Formalarni to'ldiring
   → Telefon raqami uchun raqamli klaviatura chiqadi. Maydonlar klaviatura ostida qolib ketmaydi.

4. Rasmlarni ko'ring
   → Rasmlar tez ochiladi va buzilmaydi.

5. Sotuvchi kabinetini ham telefondan oching
   → Menyu ochiladi, jadvallar surilib ko'rinadi.

6. Sekin internetda sinab ko'ring (brauzer sozlamasidan "Slow 3G")
   → Sahifa ochiladi, "yuklanmoqda" belgisi ko'rinadi, cheksiz kutish bo'lmaydi.

**Tayyor deb hisoblanadi:** oltala qadam ham telefonda qulay ishlaydi.`,
  tests:["TC1 telefonda gorizontal surish yo'q","TC2 butun buyurtma yo'li telefonda o'tadi","TC3 formalar va klaviatura qulay","TC4 rasmlar to'g'ri ochiladi","TC5 kabinet telefonda ishlaydi","TC6 sekin internetda ham ochiladi"] },

{ code:'C8.9', name:"C8.9 QO'LDA TEST: xavfsizlik", member:'Lead',
  labels:"Qo'lda test;Blocker;M", due:'2026-09-30',
  desc:HEAD+`**Maqsad:** Tizimga zarar yetkazish mumkinmi — buni ishga tushirishdan oldin o'zimiz tekshiramiz.

**Qadamlar:**

1. Login sahifasida ataylab 10 marta noto'g'ri parol kiriting
   → 5-6 urinishdan keyin "juda ko'p urinish" degan xabar chiqishi kerak. Cheksiz urinib bo'lmasligi kerak.

2. Manzil qatoriga qarang (sayt va kabinet)
   → Ikkalasi ham \`https://\`. \`http://\` bilan kirsangiz avtomat \`https://\` ga o'tishi kerak.

3. Chiqing (logout), keyin brauzerda "orqaga" tugmasini bosing
   → Kabinet sahifasi ochilib qolmasligi kerak, login so'ralishi kerak.

4. Bir soat kutmasdan tekshirish uchun: kirgan holda uzoq ishlang
   → Sessiya o'z-o'zidan uzilmasligi kerak. Uzilsa — bu xato.

5. Brauzer konsolini oching (F12) va \`document.cookie\` deb yozing
   → Refresh token ko'rinmasligi kerak. Ko'rinса — jiddiy xato.

6. Boshqa foydalanuvchining ma'lumotini manzil orqali ochishga urinib ko'ring
   → Ruxsat berilmasligi kerak.

7. Xato chiqargan holatda javobga qarang
   → Ichki texnik ma'lumot (fayl yo'llari, baza xatosi) ko'rinmasligi kerak.

**Tayyor deb hisoblanadi:** yettala qadam ham himoyalangan. Birortasi ochiq bo'lsa — ishga tushirish to'xtatiladi.`,
  tests:["TC1 ko'p urinishdan keyin to'siladi","TC2 hamma joyda HTTPS","TC3 chiqqandan keyin orqaga qaytib kirib bo'lmaydi","TC4 sessiya o'z-o'zidan uzilmaydi","TC5 refresh token JS'ga ko'rinmaydi","TC6 birovning ma'lumotiga kirib bo'lmaydi","TC7 xatolarda ichki ma'lumot chiqmaydi"] },

{ code:'C8.10', name:"C8.10 QO'LDA TEST: qidiruv tizimi va havola ulashish", member:'Bahodir',
  labels:"Qo'lda test;High;S", due:'2026-09-30',
  desc:HEAD+`**Maqsad:** Sayt Google'da topiladimi va havola ulashilganda chiroyli ko'rinadimi. Bu mijoz oqimining asosiy manbai.

**Qadamlar:**

1. Mahsulot havolasini **Telegram'ga** tashlang (o'zingizga yozing)
   → Mahsulot rasmi, nomi va narxi bilan kartochka chiqishi kerak. Faqat havola ko'rinsa — xato.

2. Do'kon havolasini ham Telegram'ga tashlang
   → Do'kon nomi va logotipi bilan kartochka chiqadi.

3. Mahsulot sahifasida sichqoncha o'ng tugmasi → "Sahifa manbasini ko'rish"
   → Mahsulot nomi va narxi **manbada** ko'rinishi kerak. Faqat bo'sh \`<div id="root">\` bo'lsa — SSR ishlamayapti.

4. \`<domen>/sitemap.xml\` ni oching
   → Mahsulot va do'kon havolalari ro'yxati chiqadi.

5. \`<domen>/robots.txt\` ni oching
   → Indekslashga ruxsat berilgan bo'lishi kerak (\`Disallow: /\` bo'lmasligi kerak).

6. Kabinet sahifasida manbani ko'ring
   → U yerda \`noindex\` bo'lishi kerak — kabinet Google'da chiqmasligi kerak.

7. Har sahifada brauzer yorlig'idagi sarlavhaga qarang
   → Har sahifada o'z sarlavhasi bo'lishi kerak, hammasida bir xil emas.

**Tayyor deb hisoblanadi:** yettala qadam ham to'g'ri. 1 va 3-qadamlar eng muhimi.`,
  tests:["TC1 Telegram'da mahsulot kartochkasi chiqadi","TC2 do'kon havolasi ham kartochka beradi","TC3 sahifa manbasida mahsulot ma'lumoti bor","TC4 sitemap.xml ochiladi","TC5 robots.txt indekslashga ruxsat beradi","TC6 kabinet noindex","TC7 har sahifada o'z sarlavhasi"] },

{ code:'C8.11', name:"C8.11 QO'LDA TEST: xato holatlari va chidamlilik", member:'Lead',
  labels:"Qo'lda test;High;M", due:'2026-09-30',
  desc:HEAD+`**Maqsad:** Nimadir buzilganda tizim qanday tutadi. Bu ko'pincha e'tibordan qoladi va aynan shu joyda foydalanuvchi yo'qoladi.

**Qadamlar:**

1. Mavjud bo'lmagan mahsulot manzilini oching
   → "Topilmadi" sahifasi chiqadi, oq ekran yoki texnik xato emas.

2. Savatga mahsulot solib turib, sotuvchi kabinetidan o'sha mahsulot qoldig'ini 0 qiling, keyin buyurtma bering
   → "Qoldiq yetarli emas" degan tushunarli xabar chiqishi kerak, buyurtma yaratilmasligi kerak.

3. Buyurtma formasida majburiy maydonlarni bo'sh qoldiring
   → Qaysi maydon to'ldirilmagani aniq ko'rsatiladi.

4. Buyurtma tugmasini **tez ketma-ket ikki marta** bosing
   → Bitta buyurtma yaratilishi kerak, ikkita emas.

5. Internetni uzib, sahifani yangilang
   → Tushunarli xabar chiqadi ("ulanish yo'q"), cheksiz aylanuvchi belgi emas.

6. Backend'ni vaqtincha to'xtating va saytga kiring
   → "Server javob bermayapti" degan tushunarli holat chiqadi.

7. Juda uzun matn kiriting (masalan 5000 belgi tavsif)
   → Tizim buzilmaydi, chegara haqida xabar beradi.

**Tayyor deb hisoblanadi:** yettala holatda ham tizim tushunarli javob beradi va ma'lumot buzilmaydi. 4-qadam (ikki marta bosish) eng muhimi — u pul bilan bog'liq.`,
  tests:["TC1 mavjud bo'lmagan sahifada 404","TC2 qoldiq yetmasa buyurtma yaratilmaydi","TC3 forma xatolari aniq ko'rsatiladi","TC4 ikki marta bosishda bitta buyurtma","TC5 internet uzilganda tushunarli xabar","TC6 backend o'chganda tushunarli holat","TC7 juda uzun matn tizimni buzmaydi"] },
];
