// Storefront (xaridor sayti) — alohida Next.js repo. Barcha muddat: 15-sentabr.
export default [
{
  code: 'C2.12', name: "C2.12 Storefront uchun alohida repo va Next.js skeleti",
  member: 'Bahodir', labels: 'Phase 2;Frontend;Blocker;M', due: '2026-09-08',
  desc: `**Maqsad:** Xaridorlar uchun alohida sayt loyihasini noldan ochish. Bu sotuvchi kabinetidan butunlay ayrim dastur bo'ladi.

**Nega alohida?** Hozirgi kabinet dasturi qidiruv tizimlaridan ataylab yopilgan (\`noindex\`) — sotuvchilar uchun bu to'g'ri. Xaridor sayti esa aksincha, Google va Yandex'da chiqishi kerak. Bundan tashqari xaridor havolani Telegram'ga tashlaganda mahsulot nomi, narxi va rasmi ko'rinishi shart — buning uchun sahifa serverda tayyorlanishi kerak (Next.js shuni qiladi), oddiy React'da bu ishlamaydi.

**Ishlar:**
- GitHub'da yangi repo: \`5E-TECH/Marketplace-Storefront\`
- Next.js (App Router) + TypeScript o'rnatish
- ESLint, Prettier, \`.gitignore\`, \`README.md\`
- Papka tuzilishi: \`app/\` (sahifalar), \`components/\` (qismlar), \`lib/\` (yordamchi kod)
- \`.env.example\` — API manzili uchun
- Bo'sh bosh sahifa ochilishini tekshirish

**Tayyor deb hisoblanadi:** repo bor, \`npm run dev\` bilan sayt ochiladi, \`npm run build\` xatosiz o'tadi.`,
  tests: ["TC1 repo yaratilgan va jamoa a'zolari kira oladi", "TC2 npm run dev bosh sahifani ochadi", "TC3 npm run build xatosiz tugaydi", "TC4 lint xatosiz o'tadi"],
},
{
  code: 'C2.23', name: "C2.23 Backend bilan bog'lanish qatlami (API client va tiplar)",
  member: 'Bahodir', labels: 'Phase 2;Frontend;Blocker;S', due: '2026-09-08',
  desc: `**Maqsad:** Saytning backend bilan gaplashadigan yagona qismini yozish, shunda har sahifa alohida usul o'ylab topmaydi.

**Oddiy tilda:** sayt mahsulotlar ro'yxatini, narxlarni, savatni backenddan so'raydi. Shu so'rovlarni bitta joyda jamlash kerak — manzil, xatolarni ushlash, javobni tekshirish. Aks holda har sahifa o'zicha yozadi va bittasi buzilsa qayerdaligini topib bo'lmaydi.

**Muhim:** backend javob shakli allaqachon hujjatlashtirilgan (\`contract/openapi.json\`). Shundan TypeScript tiplarini generatsiya qilish kerak — qo'lda yozilsa backend o'zgarganda sayt jim buziladi.

**Ishlar:**
- \`lib/api.ts\` — barcha so'rovlar shu yerdan
- Backend manzili \`.env\` dan olinadi (kodga yozilmaydi)
- OpenAPI'dan tiplar generatsiyasi
- Xato holatlari: internet yo'q, server javob bermadi, 404
- Serverda (SSR) va brauzerda ishlashi

**Tayyor deb hisoblanadi:** bitta test sahifada backenddan mahsulotlar ro'yxati kelib tushadi.`,
  tests: ["TC1 backenddan mahsulotlar ro'yxati keladi", "TC2 backend o'chirilganda sayt tushunarli xato ko'rsatadi", "TC3 tiplar OpenAPI'dan generatsiya qilingan", "TC4 API manzili .env dan o'qiladi"],
},
{
  code: 'C2.22', name: "C2.22 Dizayn asosi va umumiy komponentlar",
  member: 'Bahodir', labels: 'Phase 2;Frontend;High;M', due: '2026-09-09',
  desc: `**Maqsad:** Saytning umumiy ko'rinishini va barcha sahifalarda takrorlanadigan qismlarni bir marta yasash.

**Oddiy tilda:** har sahifada bir xil narsalar bor — tepadagi menyu, pastdagi ma'lumot, mahsulot kartochkasi, tugmalar. Bularni har sahifada qaytadan yozish o'rniga bir marta yasab, hamma joyda ishlatiladi. Shunda sayt yaxlit ko'rinadi va keyin o'zgartirish oson bo'ladi.

**Diqqat:** kabinetda ishlatilgan Ant Design bu yerga to'g'ri kelmaydi — u admin panellar uchun mo'ljallangan, og'ir va ko'rinishi boshqacha. Xaridor sayti yengil va chiroyli bo'lishi kerak.

**Ishlar:**
- Rang, shrift va oraliqlar tizimi (bir marta belgilanadi)
- Tepa qism: logo, qidiruv, savat belgisi, kirish tugmasi
- Past qism: aloqa, sahifa havolalari
- Mahsulot kartochkasi: rasm, nom, narx, do'kon nomi
- Tugmalar, yuklanish holati, bo'sh ro'yxat holati, xato holati
- Telefon ekraniga moslik (birinchi navbatda telefon)

**Tayyor deb hisoblanadi:** bitta namuna sahifada barcha komponentlar ko'rinadi va telefonda ham to'g'ri chiqadi.`,
  tests: ["TC1 tepa va past qism barcha sahifada ko'rinadi", "TC2 mahsulot kartochkasi rasm/nom/narx/do'kon ko'rsatadi", "TC3 telefon ekranida (375px) gorizontal siljish yo'q", "TC4 bo'sh va xato holatlari alohida ko'rinadi"],
},
{
  code: 'C2.13', name: "C2.13 Bosh sahifa va mahsulotlar katalogi",
  member: 'Bahodir', labels: 'Phase 2;Frontend;Blocker;L', due: '2026-09-10',
  desc: `**Maqsad:** Xaridor saytga kirganda birinchi ko'radigan sahifa va undagi mahsulotlar ro'yxati.

**Oddiy tilda:** odam \`domen.uz\` ga kiradi va darhol sotuvdagi mahsulotlarni ko'radi — rasm, nom, narx. Pastga tushgani sari yana mahsulotlar chiqadi. Kategoriyalarni bosib, faqat kerakli turdagi mahsulotlarni ko'rishi mumkin.

**Muhim:** ro'yxat serverda tayyorlanishi kerak (SSR). Ya'ni sahifa ochilishi bilan mahsulotlar allaqachon o'rnida bo'ladi — kutish yo'q va Google ularni ko'ra oladi.

**Ishlar:**
- Bosh sahifa: kategoriyalar va mahsulotlar ro'yxati
- Sahifalash yoki pastga tushganda yuklash
- Kategoriya bo'yicha filtr (\`/katalog/telefonlar\` ko'rinishida)
- Saralash: arzondan qimmatga, yangi kelganlar
- Filtr holati manzilda saqlanadi — havolani ulashsa, o'sha ko'rinish ochiladi
- Mahsulot yo'q bo'lsa tushunarli xabar

**Tayyor deb hisoblanadi:** bosh sahifada haqiqiy mahsulotlar chiqadi, kategoriya va saralash ishlaydi, havola ulashilsa o'sha holat ochiladi.`,
  tests: ["TC1 bosh sahifada backenddan kelgan mahsulotlar ko'rinadi", "TC2 kategoriya tanlanganda ro'yxat filtrlanadi", "TC3 saralash narx bo'yicha ishlaydi", "TC4 filtrli havola qayta ochilganda o'sha holat tiklanadi", "TC5 sahifa manbasida (JS o'chirilganda) mahsulot nomlari ko'rinadi"],
},
{
  code: 'C2.24', name: "C2.24 Qidiruv",
  member: 'Bahodir', labels: 'Phase 2;Frontend;High;M', due: '2026-09-10',
  desc: `**Maqsad:** Xaridor kerakli mahsulotni nomi bo'yicha topa olsin.

**Oddiy tilda:** tepadagi qidiruv maydoniga "telefon" deb yozadi va tegishli mahsulotlar chiqadi. Yozayotganda taklif ko'rinsa yanada qulay. Hech narsa topilmasa — bo'sh ekran emas, tushunarli xabar va boshqa takliflar.

**Ishlar:**
- Tepadagi qidiruv maydoni (barcha sahifada)
- Qidiruv natijalari sahifasi
- Yozilgan so'z manzilda saqlanadi (\`/qidiruv?q=telefon\`)
- Natija yo'q holati
- Qidiruvni filtr va saralash bilan birga ishlatish

**Tayyor deb hisoblanadi:** so'z yozilganda tegishli mahsulotlar chiqadi, natija yo'q bo'lsa tushunarli xabar ko'rinadi.`,
  tests: ["TC1 qidiruv so'zi bo'yicha natija chiqadi", "TC2 natija yo'q bo'lsa tushunarli xabar ko'rinadi", "TC3 qidiruv so'zi manzilda saqlanadi", "TC4 qidiruv natijasini saralash mumkin"],
},
{
  code: 'C2.14', name: "C2.14 Mahsulot sahifasi",
  member: 'Bahodir', labels: 'Phase 2;Frontend;Blocker;L', due: '2026-09-11',
  desc: `**Maqsad:** Bitta mahsulot haqida to'liq ma'lumot beradigan sahifa — bu saytning eng muhim sahifasi.

**Oddiy tilda:** xaridor mahsulotni bosadi va uning rasmlarini, narxini, tavsifini, qaysi do'kondan ekanini ko'radi. Rang yoki o'lcham kabi variantlar bo'lsa tanlaydi. "Savatga qo'shish" tugmasini bosadi.

**Eng muhim jihat — ulashish.** Xaridor bu havolani Telegram'ga tashlasa, o'sha yerda mahsulot rasmi, nomi va narxi ko'rinishi kerak. Buning uchun sahifa serverda tayyorlanadi va maxsus teglar qo'yiladi. Bu qilinmasa, ulashilgan har bir havola bo'sh ko'rinadi va bu eng arzon mijoz oqimini yo'qotish demak.

**Ishlar:**
- Mahsulot sahifasi manzili: \`/mahsulot/<nomi>\`
- Rasmlar galereyasi
- Nom, narx, tavsif, qoldiq holati
- Variantlar tanlash (rang, o'lcham) va variantga qarab narx o'zgarishi
- Do'kon nomi va do'kon sahifasiga havola
- "Savatga qo'shish" tugmasi
- Ulashish uchun teglar (nom, narx, rasm) — serverda tayyorlanadi
- Google uchun mahsulot ma'lumoti (narx, mavjudlik)
- Mahsulot topilmasa 404 sahifasi

**Tayyor deb hisoblanadi:** mahsulot sahifasi to'liq ochiladi va havola Telegram'ga tashlanganda kartochka ko'rinadi.`,
  tests: ["TC1 mahsulot nomi, narxi, rasmlari va tavsifi ko'rinadi", "TC2 variant tanlanganda narx va qoldiq yangilanadi", "TC3 savatga qo'shish ishlaydi", "TC4 havola Telegram'ga tashlanganda nom/narx/rasm ko'rinadi", "TC5 mavjud bo'lmagan mahsulotda 404 chiqadi"],
},
{
  code: 'C2.15', name: "C2.15 Do'kon sahifasi",
  member: 'Bahodir', labels: 'Phase 2;Frontend;Normal;M', due: '2026-09-11',
  desc: `**Maqsad:** Har bir sotuvchining o'z sahifasi — xaridor do'konni ko'rib, uning barcha mahsulotlarini ko'zdan kechirsin.

**Oddiy tilda:** mahsulot sahifasida do'kon nomi bosilsa, o'sha do'konning sahifasi ochiladi: logo, nomi, tavsifi, reytingi va sotuvdagi barcha mahsulotlari.

**Ishlar:**
- Do'kon sahifasi manzili: \`/dokon/<nomi>\`
- Do'kon logotipi, nomi, tavsifi, reytingi
- O'sha do'kon mahsulotlari ro'yxati (filtr va saralash bilan)
- Ulashish uchun teglar (do'kon nomi va logotipi)
- Do'kon topilmasa yoki faol bo'lmasa tushunarli xabar

**Tayyor deb hisoblanadi:** do'kon sahifasi ochiladi va faqat o'sha do'kon mahsulotlari ko'rinadi.`,
  tests: ["TC1 do'kon nomi, logotipi va tavsifi ko'rinadi", "TC2 faqat o'sha do'konning mahsulotlari chiqadi", "TC3 mavjud bo'lmagan do'konda tushunarli xabar", "TC4 mahsulot sahifasidan do'konga o'tish ishlaydi"],
},
{
  code: 'C2.16', name: "C2.16 Savat",
  member: 'Bahodir', labels: 'Phase 2;Frontend;Blocker;L', due: '2026-09-12',
  desc: `**Maqsad:** Xaridor tanlagan mahsulotlarini bir joyga yig'ib, keyin buyurtma bera olsin.

**Oddiy tilda:** mahsulotni savatga qo'shadi, keyin savatga kirib nechta olishini o'zgartiradi yoki keraksizini o'chiradi. Pastda umumiy summa ko'rinadi.

**Ikkita muhim jihat:**

Birinchisi — **ro'yxatdan o'tmasdan ham savat ishlashi kerak.** Odam saytga birinchi marta kirganda darrov ro'yxatdan o'tishga majbur bo'lmasligi kerak, aks holda ketib qoladi. Backend buni qo'llaydi (mehmon savati).

Ikkinchisi — **keyin kirsa, savati yo'qolmasligi kerak.** Mehmon holida yig'gan mahsulotlari akkauntiga qo'shilib ketadi. Backendda buning uchun maxsus imkoniyat bor.

**Ishlar:**
- Savat sahifasi: mahsulotlar, miqdor, narx
- Miqdorni o'zgartirish va o'chirish
- Sotuvchilar bo'yicha guruhlash (turli do'kondan olingan bo'lsa)
- Umumiy summa hisobi
- Mehmon savati (ro'yxatdan o'tmasdan)
- Kirgandan keyin mehmon savatini akkauntga birlashtirish
- Savat bo'sh holati
- Tepadagi savat belgisida mahsulot soni

**Tayyor deb hisoblanadi:** ro'yxatdan o'tmasdan savatga qo'shish ishlaydi va kirgandan keyin savat saqlanib qoladi.`,
  tests: ["TC1 ro'yxatdan o'tmasdan savatga qo'shish ishlaydi", "TC2 miqdorni o'zgartirish va o'chirish ishlaydi", "TC3 umumiy summa to'g'ri hisoblanadi", "TC4 kirgandan keyin mehmon savati yo'qolmaydi", "TC5 turli do'kon mahsulotlari alohida guruhda ko'rinadi"],
},
{
  code: 'C2.17', name: "C2.17 Buyurtma berish (checkout)",
  member: 'Bahodir', labels: 'Phase 2;Frontend;Blocker;L', due: '2026-09-12',
  desc: `**Maqsad:** Savatdagi mahsulotlarni haqiqiy buyurtmaga aylantirish — bu pul keladigan qadam.

**Oddiy tilda:** xaridor "Buyurtma berish" tugmasini bosadi. Ismi va telefonini yozadi, yetkazib berish manzilini tanlaydi (viloyat, tuman, ko'cha). Yetkazib berish narxi hisoblanib ko'rsatiladi. To'lov turini tanlaydi — hozircha qo'lga to'lash. "Tasdiqlash" tugmasini bosadi va buyurtma yaratiladi.

**Muhim:** kabinet dasturida allaqachon shunga o'xshash sahifa bor (\`CheckoutPage\`) — uni noldan yozish shart emas, mantiqini bu yerga ko'chirish mumkin. Kabinetdan esa u olib tashlanadi (C5.4).

**Ishlar:**
- Buyurtma berish sahifasi
- Ism, telefon, manzil maydonlari (tekshiruv bilan)
- Viloyat va tuman tanlash
- Yetkazib berish narxini oldindan hisoblash
- To'lov turi tanlash
- Buyurtmani yaratish va tasdiqlash
- Xato holatlari: qoldiq yetmadi, manzil noto'g'ri, server javob bermadi
- Ro'yxatdan o'tmagan xaridor uchun ham ishlashi

**Tayyor deb hisoblanadi:** savatdan buyurtma yaratiladi va u sotuvchi kabinetida ko'rinadi.`,
  tests: ["TC1 to'ldirilgan forma bilan buyurtma yaratiladi", "TC2 yetkazib berish narxi manzilga qarab hisoblanadi", "TC3 majburiy maydon bo'sh bo'lsa tushunarli xato chiqadi", "TC4 yaratilgan buyurtma sotuvchi kabinetida ko'rinadi", "TC5 ro'yxatdan o'tmagan xaridor ham buyurtma bera oladi"],
},
{
  code: 'C2.18', name: "C2.18 Buyurtma tasdiqlangandan keyingi sahifa va kuzatish",
  member: 'Bahodir', labels: 'Phase 2;Frontend;High;M', due: '2026-09-15',
  desc: `**Maqsad:** Buyurtma berilgandan keyin xaridor "bo'ldimi?" deb hayron qolmasin va buyurtmasi qayerdaligini ko'ra olsin.

**Oddiy tilda:** tasdiqlash tugmasidan keyin "Buyurtmangiz qabul qilindi" degan sahifa chiqadi: buyurtma raqami, nima olingani, qancha to'lash kerakligi, qachon yetkazilishi. Keyinroq shu raqam orqali buyurtma holatini ko'radi — qabul qilindi, yig'ilmoqda, yo'lda, yetkazildi.

**Ishlar:**
- Tasdiqlash sahifasi: buyurtma raqami va tafsilotlari
- Buyurtma holatini kuzatish sahifasi
- Elchi yetkazib berish holati (backend beradi)
- Buyurtma raqamini saqlab qo'yish (mehmon uchun ham)
- Buyurtma topilmasa tushunarli xabar

**Tayyor deb hisoblanadi:** buyurtmadan keyin tasdiq sahifasi chiqadi va holat kuzatiladi.`,
  tests: ["TC1 buyurtmadan keyin tasdiq sahifasi raqam bilan chiqadi", "TC2 buyurtma tafsilotlari to'g'ri ko'rinadi", "TC3 buyurtma holati kuzatiladi", "TC4 mehmon ham o'z buyurtmasini ko'ra oladi"],
},
{
  code: 'C2.21', name: "C2.21 Xaridor akkaunti (kirish, ro'yxat, mening buyurtmalarim)",
  member: 'Bahodir', labels: 'Phase 2;Frontend;High;M', due: '2026-09-12',
  desc: `**Maqsad:** Xaridor o'z akkauntini ochib, buyurtmalari tarixini ko'ra olsin.

**Oddiy tilda:** telefon raqami va parol bilan ro'yxatdan o'tadi yoki kiradi. Kirgandan keyin "Mening buyurtmalarim" bo'limida avval bergan buyurtmalarini ko'radi.

**Muhim:** kirish majburiy emas. Xaridor ro'yxatdan o'tmasdan ham mahsulot ko'rishi, savatga qo'shishi va buyurtma berishi kerak. Akkaunt faqat qulaylik uchun.

**Ishlar:**
- Kirish va ro'yxatdan o'tish sahifalari
- Parolni unutgan holati
- Kirgandan keyin savatni birlashtirish (C2.16 bilan bog'liq)
- "Mening buyurtmalarim" ro'yxati
- Profil: ism, telefon o'zgartirish
- Chiqish

**Tayyor deb hisoblanadi:** xaridor ro'yxatdan o'tib kiradi va buyurtmalarini ko'radi.`,
  tests: ["TC1 ro'yxatdan o'tish va kirish ishlaydi", "TC2 kirgandan keyin mening buyurtmalarim ko'rinadi", "TC3 kirmasdan ham buyurtma berish mumkin", "TC4 chiqish ishlaydi va sessiya tozalanadi"],
},
{
  code: 'C2.25', name: "C2.25 Sevimlilar",
  member: 'Bahodir', labels: 'Phase 2;Frontend;Normal;S', due: '2026-09-15',
  desc: `**Maqsad:** Xaridor yoqqan mahsulotni belgilab qo'yib, keyin osongina topa olsin.

**Oddiy tilda:** mahsulot yonidagi yurakcha belgisini bosadi va u "Sevimlilar" ro'yxatiga tushadi. Keyin o'sha bo'limga kirib, saqlab qo'yganlarini ko'radi.

Backend buni ro'yxatdan o'tmagan xaridor uchun ham qo'llaydi.

**Ishlar:**
- Mahsulot kartochkasi va sahifasida yurakcha belgisi
- Sevimlilar sahifasi
- Qo'shish va olib tashlash
- Ro'yxatdan o'tmasdan ham ishlashi
- Kirgandan keyin akkauntga birlashtirish

**Tayyor deb hisoblanadi:** mahsulotni sevimlilarga qo'shish va ro'yxatda ko'rish ishlaydi.`,
  tests: ["TC1 mahsulotni sevimlilarga qo'shish ishlaydi", "TC2 sevimlilar sahifasida ro'yxat ko'rinadi", "TC3 olib tashlash ishlaydi", "TC4 kirgandan keyin sevimlilar saqlanadi"],
},
{
  code: 'C2.26', name: "C2.26 Sharhlar va reyting",
  member: 'Bahodir', labels: 'Phase 2;Frontend;Normal;M', due: '2026-09-15',
  desc: `**Maqsad:** Xaridorlar mahsulot haqida fikr yozsin va boshqalar shu fikrga qarab tanlasin.

**Oddiy tilda:** mahsulot sahifasining pastida boshqa xaridorlarning fikrlari va yulduzchali baholari ko'rinadi. Mahsulotni sotib olgan odam o'zi ham baho va fikr qoldira oladi.

**Muhim:** faqat haqiqatda sotib olgan odam sharh yoza olishi kerak — aks holda soxta sharhlar to'lib ketadi. Backend buni tekshiradi.

**Ishlar:**
- Mahsulot sahifasida sharhlar ro'yxati
- O'rtacha baho (yulduzchalar) va sharhlar soni
- Sharh yozish formasi (faqat sotib olganlar uchun)
- Sharh yo'q holati
- Sharhlarni sahifalash

**Tayyor deb hisoblanadi:** sharhlar ko'rinadi va sotib olgan xaridor sharh yoza oladi.`,
  tests: ["TC1 mahsulot sahifasida sharhlar va o'rtacha baho ko'rinadi", "TC2 sotib olgan xaridor sharh yoza oladi", "TC3 sotib olmagan odam sharh yoza olmaydi", "TC4 sharh yo'q holati tushunarli ko'rinadi"],
},
{
  code: 'C2.27', name: "C2.27 Qidiruv tizimlari uchun sozlash (SEO)",
  member: 'Bahodir', labels: 'Phase 2;Frontend;High;M', due: '2026-09-15',
  desc: `**Maqsad:** Sayt Google va Yandex'da chiqsin — bu marketplace uchun asosiy mijoz oqimi.

**Oddiy tilda:** odam Google'da "telefon narxi Toshkent" deb qidirganda sizning mahsulot sahifangiz chiqishi kerak. Buning uchun har sahifada to'g'ri sarlavha, tavsif va qidiruv tizimlariga yo'l ko'rsatuvchi fayllar bo'lishi kerak.

**Diqqat:** kabinet dasturida \`noindex\` yozilgan — ya'ni qidiruv tizimlariga "meni ko'rsatma" deyilgan. Storefront'da bu bo'lmasligi kerak, aks holda hech qachon topilmaydi.

**Ishlar:**
- Har sahifa uchun sarlavha va tavsif
- \`sitemap.xml\` — barcha mahsulot va do'kon sahifalari ro'yxati (avtomat yangilanadi)
- \`robots.txt\` — qidiruv tizimlariga ruxsat
- Ulashish teglari (Telegram, Facebook) barcha sahifada
- Mahsulot uchun tuzilgan ma'lumot (narx, mavjudlik) — Google buni maxsus ko'rsatadi
- Har sahifada bitta asosiy manzil (takrorlanish bo'lmasin)

**Tayyor deb hisoblanadi:** sitemap ochiladi, robots ruxsat beradi, mahsulot havolasi ulashilganda kartochka chiqadi.`,
  tests: ["TC1 /sitemap.xml ochiladi va mahsulot havolalari bor", "TC2 /robots.txt indekslashga ruxsat beradi", "TC3 har sahifada o'z sarlavhasi va tavsifi bor", "TC4 mahsulot sahifasida tuzilgan ma'lumot bor", "TC5 hech bir sahifada noindex qolmagan"],
},
{
  code: 'C2.28', name: "C2.28 Storefront'ni serverga chiqarish (deploy)",
  member: 'Lead', labels: 'Phase 2;DevOps;Blocker;M', due: '2026-09-15',
  desc: `**Maqsad:** Yozilgan saytni haqiqiy manzilda ishlatib qo'yish, shunda odamlar kira olsin.

**Oddiy tilda:** hozircha sayt faqat dasturchining kompyuterida ishlaydi. Uni serverga qo'yish kerak: \`domen.uz\` manzilida ochilsin, o'zi ishlab tursin, kod o'zgarganda avtomat yangilansin.

**Muhim farq:** kabinetdan farqli, bu sayt serverda ishlaydigan dastur (SSR). Ya'ni faqat fayllarni qo'yish yetmaydi — Node.js jarayoni doim ishlab turishi kerak.

**Ishlar:**
- Dockerfile (Next.js production rejimi)
- \`docker-compose.prod.yml\` — mavjud \`marketplace_edge\` tarmog'iga ulanadi
- Cloudflare tunnel'ga ildiz domen qo'shish (C5.2 bilan bog'liq)
- CI: har push'da tekshiruv, \`main\`ga push'da avtomat deploy
- Sog'liq tekshiruvi (\`/healthz\`)
- Backend \`CORS_ORIGINS\` ga yangi domen qo'shish

**Tayyor deb hisoblanadi:** \`domen.uz\` ochiladi, \`main\`ga push qilinganda sayt o'zi yangilanadi.`,
  tests: ["TC1 domen ochilganda katalog ko'rinadi", "TC2 main'ga push avtomat deploy qiladi", "TC3 healthcheck javob beradi", "TC4 sayt HTTPS orqali ochiladi", "TC5 backend so'rovlari CORS xatosisiz o'tadi"],
},
];
