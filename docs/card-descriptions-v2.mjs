export default {
"C1.21": `**Maqsad:** Sotuvchi bitta mahsulotning turli ko'rinishlarini (rang, o'lcham, hajm) alohida boshqara olsin.

**Oddiy tilda:** bitta futbolka bo'lsa ham, uning S/M/L o'lchamlari bor va har birining qoldig'i alohida. Sotuvchi mahsulot tahrirlash sahifasida jadval ko'rinishida variant qo'shadi: nomi, artikuli (SKU), narxi, qoldig'i. Keraksizini o'chiradi.

Variant qo'shilmagan mahsulot ham ishlashi kerak — u holda bitta standart variant o'zi yaratiladi va sotuvchi buni sezmaydi.

**Ishlar:**
- Variantlar jadvali: qo'shish, tahrirlash, o'chirish
- Har variantda: nom, SKU, narx, qoldiq
- Variantsiz mahsulot uchun standart variant
- Saqlashda backendga yuborish va qaytib kelganini tekshirish

**Tayyor deb hisoblanadi:** variant qo'shilib saqlanadi, sahifa yangilanganda joyida turadi, o'chirilganda yo'qoladi.`,

"C1.23": `**Maqsad:** Sotuvchi o'z omborlarini ro'yxatga olib boshqara olsin.

**Oddiy tilda:** sotuvchining bir nechta ombori bo'lishi mumkin — do'kon, uy, shahar tashqarisidagi sklad. Har qaysida qoldiq alohida hisoblanadi. Bu sahifada omborlar ro'yxati ko'rinadi, yangisini qo'shish va tahrirlash mumkin.

Bittasi "asosiy" (default) deb belgilanadi — yangi mahsulot qoldig'i o'shanga tushadi. Asosiy ombor har doim faqat bitta bo'lishi kerak.

**Ishlar:**
- Omborlar ro'yxati jadvali
- Yangi ombor qo'shish va tahrirlash oynasi
- Asosiy ombor belgilash (yangisi belgilanganda eskisi bekor bo'ladi)
- Ombor o'chirish
- Ombor yo'q holati

**Tayyor deb hisoblanadi:** ombor qo'shiladi, ro'yxatda ko'rinadi va asosiy belgilanganda faqat bittasi asosiy bo'lib qoladi.`,

"C1.24": `**Maqsad:** Sotuvchi qaysi mahsulotdan qancha qolganini ko'rsin va qoldiqni to'g'rilay olsin.

**Oddiy tilda:** jadvalda har mahsulot va uning omborlardagi qoldig'i ko'rinadi. Yangi tovar kelganda "kirim" qiladi (masalan +50 dona). Sanoqda xato chiqsa "tuzatish" qiladi (masalan −3 dona).

Kam qolgan mahsulotlar ajratib ko'rsatiladi, shunda sotuvchi tugab qolishidan oldin xabar topadi.

**Ishlar:**
- Qoldiq jadvali: mahsulot, ombor, miqdor
- Kirim oynasi (musbat son qo'shish)
- Tuzatish oynasi (musbat yoki manfiy o'zgartirish)
- Kam qolganlarni ajratib ko'rsatish
- Ombor bo'yicha filtr

**Tayyor deb hisoblanadi:** kirim qilingandan keyin jadvaldagi son o'zgaradi, kam qolgan tovar ko'zga tashlanadi.`,

"C1.25": `**Maqsad:** Sotuvchi o'ziga tushgan buyurtmalarni ko'rib, ular bilan ishlay olsin.

**Oddiy tilda:** xaridor buyurtma berganda u shu ro'yxatda paydo bo'ladi: kim buyurtma qilgan, nima olgan, qancha to'laydi, hozir qaysi bosqichda. Sotuvchi buyurtmani ochib, holatini o'zgartiradi — tasdiqlaydi yoki yetkazib berishga topshiradi.

Har buyurtmada Elchi yetkazib berish tarixi ko'rinadi: qachon qabul qilingan, qachon yo'lga chiqqan, qachon yetkazilgan.

**Ishlar:**
- Buyurtmalar ro'yxati (sahifalash bilan)
- Holat, sana va qidiruv bo'yicha filtr
- Buyurtma tafsilotlari oynasi
- Holatni o'zgartirish
- Elchi yetkazib berish tarixi

**Tayyor deb hisoblanadi:** buyurtmalar ro'yxati chiqadi, filtr ishlaydi va holat o'zgartirilganda saqlanadi.`,

"C1.26": `**Maqsad:** Sotuvchi kabinetga kirganda savdosi qanday ketayotganini bir qarashda ko'rsin.

**Oddiy tilda:** bosh sahifada asosiy raqamlar chiqadi — nechta buyurtma bo'lgan, qancha tushum, nechtasi yo'lda, nechtasi yetkazilgan. Pastda kunlar bo'yicha grafik va eng ko'p sotilgan mahsulotlar.

**Muhim:** yangi sotuvchida hali hech narsa yo'q. Shunda bo'sh grafik emas, "hali buyurtma yo'q" degan tushunarli ko'rinish chiqishi kerak.

**Ishlar:**
- Ko'rsatkich kartalari: buyurtma, tushum, yo'lda, yetkazilgan, kam qoldiq
- Kunlar bo'yicha savdo grafigi
- Eng ko'p sotilgan mahsulotlar ro'yxati
- Ma'lumot yo'q holati
- Yuklanish va xato holatlari

**Tayyor deb hisoblanadi:** raqamlar backenddan keladi va yangi sotuvchida bo'sh holat chiroyli ko'rinadi.`,

"C1.27": `**Maqsad:** Admin yangi ochilgan do'konlarni ko'rib chiqib, ruxsat bersin yoki rad etsin.

**Oddiy tilda:** kimdir sotuvchi bo'lib ro'yxatdan o'tsa, do'koni darrov ishlay boshlamaydi — avval admin tekshiradi. Admin ro'yxatda kutayotgan do'konlarni ko'radi, ochib ma'lumotlarini o'qiydi va "tasdiqlash" yoki "rad etish" tugmasini bosadi.

Tasdiqlangan do'kon xaridorlarga ko'rina boshlaydi. Rad etilganida sabab yoziladi.

**Ishlar:**
- Kutayotgan do'konlar ro'yxati
- Do'kon tafsilotlari sahifasi
- Tasdiqlash va rad etish (sabab bilan)
- Holat o'zgargandan keyin ro'yxat yangilanishi
- Holat bo'yicha filtr

**Tayyor deb hisoblanadi:** admin do'konni tasdiqlaydi, holat o'zgaradi va ro'yxat yangilanadi.`,

"C1.39": `**Maqsad:** Sotuvchi o'z xodimlarini (operatorlarni) kabinetga qo'sha olsin.

**Oddiy tilda:** do'kon kattalashganda sotuvchi hamma buyurtmani o'zi ko'rib chiqolmaydi. Xodim qo'shadi — u kabinetga kiradi, lekin faqat buyurtmalar bilan ishlaydi. Mahsulot narxini o'zgartirish yoki ombor ochish kabi ishlarga ruxsati bo'lmaydi.

**Ishlar:**
- Operatorlar ro'yxati sahifasi
- Operator qo'shish (ism, telefon, parol)
- Operatorni o'chirish
- Operator kirgandagi cheklangan ko'rinish
- Operator buyurtmani tasdiqlashi va holatini o'zgartirishi

**Tayyor deb hisoblanadi:** operator qo'shiladi, kabinetga kiradi va faqat buyurtma bo'limlarini ko'radi.`,

"C2.2": `**Maqsad:** Yaratilgan yetkazib berish topshirig'ini ko'rish va kerak bo'lsa bekor qilish.

**Oddiy tilda:** buyurtma Elchi'ga topshirilgach, uning holatini bilish kerak — qabul qilindimi, yo'ldami, yetkazildimi. Xaridor voz kechsa, topshiriqni bekor qilish kerak.

**Muhim qoida:** allaqachon yetkazib bo'lingan posilkani bekor qilib bo'lmaydi. Bunday urinishda tushunarli xato qaytadi, tizim jim qolmaydi.

**Ishlar:**
- Bitta posilka ma'lumotini olish (holat, kuzatuv havolasi, undiriladigan summa)
- Posilkani bekor qilish
- Yetkazilgan posilkani bekor qilishga urinishda xato qaytarish
- Elchi tomondan kelgan xatolarni to'g'ri ko'rsatish

**Tayyor deb hisoblanadi:** posilka ma'lumoti keladi, bekor qilish ishlaydi, yetkazilganini bekor qilib bo'lmaydi.`,

"C2.19": `**Maqsad:** Xaridor ro'yxatdan o'tmasdan, faqat telefon raqami bilan buyurtma bera olsin.

**Oddiy tilda:** odam mahsulotni yoqtirdi va olmoqchi. Shu payt undan parol o'ylab topishni so'rash — ketib qolishining eng keng tarqalgan sababi. Shuning uchun ism va telefon yetarli bo'lishi kerak.

Backend shu telefon uchun yengil akkaunt yaratadi. Agar shu raqam bilan avval ham buyurtma bergan bo'lsa, yangi akkaunt yaratilmaydi — eskisi ishlatiladi. Keyinroq xaridor xohlasa parol qo'yib to'liq akkauntga aylantiradi.

**Ishlar:**
- Telefon bo'yicha yengil xaridor yaratish
- Shu telefon avval bo'lgan bo'lsa takrorlamaslik
- Mehmon buyurtmasini shu akkauntga bog'lash
- Keyin ro'yxatdan o'tsa buyurtmalari saqlanib qolishi

**Tayyor deb hisoblanadi:** ro'yxatdan o'tmasdan buyurtma beriladi va bir telefon uchun ikkinchi akkaunt yaratilmaydi.`,

"C2.20": `**Maqsad:** Xaridor buyurtma berishdan oldin yetkazib berish qancha turishini ko'rsin.

**Oddiy tilda:** manzil tanlanganda "yetkazib berish: 25 000 so'm" deb chiqishi kerak. Aks holda xaridor yakuniy summani ko'rib hayron bo'ladi va buyurtmadan voz kechadi.

**Murakkab joyi:** savatda turli do'konning mahsuloti bo'lsa, ular alohida posilka bo'lib ketadi va har biriga alohida narx hisoblanadi. Ya'ni jami yetkazib berish narxi posilkalar sonига bog'liq.

**Ishlar:**
- Elchi tarifi bo'yicha narx hisoblash
- Har posilkaga alohida hisob (ko'p do'konli savat)
- Buyurtma berishdan oldin narxni ko'rsatish
- Yakuniy summaga qo'shish
- Manzil o'zgarganda qayta hisoblash

**Tayyor deb hisoblanadi:** manzil tanlanganda narx chiqadi va ko'p do'konli savatda har posilka alohida hisoblanadi.`,

"C3.2": `**Maqsad:** Payme orqali online to'lovni ishlatish.

**Oddiy tilda:** xaridor "Payme bilan to'lash" ni tanlaydi, Payme sahifasiga o'tadi va kartadan to'laydi. Payme bizning serverga "to'lov bo'ldi" deb xabar beradi va buyurtma to'langan deb belgilanadi.

**Muhim:** Payme belgilangan tartibda 6 ta so'rov yuboradi (tekshirish, yaratish, bajarish, bekor qilish, holatni so'rash, hisobot). Hammasi to'g'ri javob berishi kerak, aks holda Payme integratsiyani tasdiqlamaydi.

**Ishlar:**
- Payme talab qiladigan 6 ta metod
- Kirish tekshiruvi (Basic auth)
- To'lov holatini bazada saqlash
- Bir xil so'rov ikki marta kelsa ikki marta hisoblamaslik
- Payme sinov muhitida (sandbox) tekshirish

**Tayyor deb hisoblanadi:** sandbox'da to'liq to'lov o'tadi va buyurtma to'langan holatiga o'tadi.`,

"C3.3": `**Maqsad:** Click orqali online to'lovni ishlatish.

**Oddiy tilda:** Payme bilan bir xil vazifa, faqat Click o'z tartibida ishlaydi — u ikki bosqichli: avval "tayyorlash" (Prepare), keyin "yakunlash" (Complete).

**Xavfsizlik:** har so'rovda maxsus imzo keladi. U tekshirilmasa, istalgan odam soxta "to'lov bo'ldi" xabarini yuborib, tovarni bepul olishi mumkin. Imzo albatta tekshirilishi kerak.

**Ishlar:**
- Prepare va Complete so'rovlarini qabul qilish
- Imzoni tekshirish
- To'lov holatini saqlash
- Takroriy so'rovni ikki marta hisoblamaslik
- Click sinov muhitida tekshirish

**Tayyor deb hisoblanadi:** sandbox'da to'lov o'tadi va noto'g'ri imzoli so'rov rad etiladi.`,

"C3.7": `**Maqsad:** Buyurtma berish sahifasiga online to'lovni ulash.

**Oddiy tilda:** xaridor buyurtmani tasdiqlaganda to'lov turini tanlaydi. "Karta bilan" ni tanlasa Payme yoki Click sahifasiga o'tadi, to'laydi va saytga qaytadi. Qaytganda buyurtma holati yangilangan bo'lishi kerak.

**Ehtiyot bo'lish kerak:** xaridor to'lov sahifasini yopib yuborishi, orqaga qaytishi yoki internet uzilishi mumkin. Har holatda sayt tushunarli javob berishi kerak, "muzlab" qolmasligi.

**Ishlar:**
- To'lov turini tanlash
- To'lov tizimiga yo'naltirish
- Qaytib kelganda holatni tekshirish
- To'lov bekor qilingan yoki uzilgan holatlar
- Buyurtma sahifasida to'lov holati

**Tayyor deb hisoblanadi:** to'lov o'tganda buyurtma to'langan bo'ladi, bekor qilinganda tushunarli xabar chiqadi.`,

"C3.8": `**Maqsad:** To'lovdan keyin xaridorga nima bo'lganini aniq aytadigan sahifa.

**Oddiy tilda:** to'lov tizimidan qaytgach xaridor uchta holatdan birini ko'radi: to'lov o'tdi, to'lov o'tmadi, yoki hali tasdiqlanmoqda. Har holatda nima qilish kerakligi yozilgan bo'ladi.

Bu sahifa bo'lmasa xaridor puli ketdimi yoki yo'qmi bilmay qoladi va qo'ng'iroq qiladi.

**Ishlar:**
- Muvaffaqiyat holati: buyurtma raqami va keyingi qadam
- Xato holati: sabab va qayta urinish tugmasi
- Kutish holati: avtomat yangilanish
- Buyurtmaga qaytish havolasi

**Tayyor deb hisoblanadi:** uchala holat ham to'g'ri chiqadi va buyurtmaga qaytish ishlaydi.`,

"C3.9": `**Maqsad:** Sotuvchi qancha ishlaganini va qachon pul olishini ko'rsin.

**Oddiy tilda:** sotuvchi savdo qildi, lekin pul darrov qo'liga tushmaydi — komissiya ushlanadi va to'lov jadval bo'yicha o'tkaziladi. Bu sahifada ko'rinadi: jami tushum, ushlangan komissiya, qo'lga tegadigan summa va o'tkazmalar tarixi.

Bu bo'lmasa sotuvchi "pulim qani?" deb doim so'raydi.

**Ishlar:**
- Balans: jami tushum, komissiya, to'lanadigan summa
- Har buyurtma bo'yicha hisob-kitob ro'yxati
- O'tkazmalar tarixi va holati
- Sana bo'yicha filtr
- Ma'lumot yo'q holati

**Tayyor deb hisoblanadi:** balans to'g'ri hisoblanadi va o'tkazmalar tarixi ko'rinadi.`,

"C4.1": `**Maqsad:** Xaridorlar mahsulotga baho va fikr qoldirsin.

**Oddiy tilda:** mahsulot sahifasida yulduzchali baho va fikrlar ko'rinadi. Yangi xaridor shu fikrlarga qarab tanlaydi — bu savdoga bevosita ta'sir qiladi.

**Muhim shart:** faqat haqiqatda sotib olgan odam sharh yoza olishi kerak. Aks holda raqobatchilar yoki bot'lar soxta sharh yozib to'ldiradi va sharhlarga ishonch yo'qoladi.

**Ishlar:**
- Sharh yozish (baho + matn)
- Faqat sotib olganlar yoza olishi tekshiruvi
- Bir mahsulotga bir marta sharh
- Mahsulotning o'rtacha bahosini hisoblash
- Sharhlar ro'yxatini berish

**Tayyor deb hisoblanadi:** sotib olgan xaridor sharh yozadi, sotib olmagani yoza olmaydi, o'rtacha baho yangilanadi.`,

"C4.2": `**Maqsad:** Xaridor tovarni qaytara olsin, sotuvchi va admin buni ko'rib chiqsin.

**Oddiy tilda:** tovar yoqmadi yoki nuqsonli chiqdi. Xaridor "qaytarish" tugmasini bosadi, sababini yozadi. So'rov sotuvchiga tushadi, u rozi bo'ladi yoki rad etadi. Rozi bo'lsa pul qaytariladi.

Har bosqichda ikkala tomon ham so'rov qayerdaligini ko'rib turishi kerak.

**Ishlar:**
- Xaridor uchun qaytarish so'rovi formasi
- Sotuvchi va admin uchun so'rovlar ro'yxati
- Tasdiqlash va rad etish (sabab bilan)
- Holatlar oqimi: yuborildi → ko'rib chiqilmoqda → tasdiqlandi/rad etildi → pul qaytarildi
- Ikkala tomonda ham holat ko'rinishi

**Tayyor deb hisoblanadi:** qaytarish so'rovi yaratiladi, sotuvchi ko'radi va holat oxirigacha o'zgaradi.`,

"C4.4": `**Maqsad:** Admin butun platforma qanday ishlayotganini raqamlarda ko'rsin.

**Oddiy tilda:** admin uchun umumiy manzara: qancha savdo bo'ldi, nechta buyurtma, qaysi do'konlar va mahsulotlar yetakchi, oqim o'sayaptimi yoki tushyaptimi. Sana oralig'ini tanlab, masalan oxirgi oyni ko'rish mumkin.

Bu raqamlar biznes qarorlari uchun kerak — qaysi kategoriya ishlayapti, qaysi do'konga e'tibor berish kerak.

**Ishlar:**
- Umumiy aylanma, buyurtmalar soni, o'rtacha chek
- Kunlar bo'yicha grafik
- Eng ko'p sotilgan mahsulotlar va do'konlar
- Sana oralig'i filtri
- Ma'lumot yo'q holati

**Tayyor deb hisoblanadi:** raqamlar to'g'ri chiqadi va sana filtri natijani o'zgartiradi.`,

"C4.5": `**Maqsad:** Admin qoidabuzar do'kon va mahsulotlarni to'xtata olsin.

**Oddiy tilda:** do'kon soxta tovar sotayotgan yoki xaridorlarni aldayotgan bo'lsa, admin uni to'xtatadi. Shu zahoti uning barcha mahsulotlari saytdan yo'qoladi. Muammo hal bo'lgach qayta yoqiladi.

Alohida mahsulotni ham to'xtatish mumkin — butun do'konni yopmasdan.

**Har bir amal yozib boriladi:** kim, qachon, nimani, nega. Bu keyin nizo chiqqanda kerak bo'ladi.

**Ishlar:**
- Do'konni to'xtatish va qayta yoqish
- Alohida mahsulotni to'xtatish
- To'xtatilgan do'kon mahsulotlari saytdan yo'qolishi
- Har amalni jurnalga yozish (kim, qachon, sabab)
- Admin uchun jurnalni ko'rish

**Tayyor deb hisoblanadi:** do'kon to'xtatilganda mahsulotlari saytdan yo'qoladi va amal jurnalga tushadi.`,

"C4.7": `**Maqsad:** Serverga chiqarishdan oldin tizim haqiqatan tayyor ekanini tekshirish.

**Oddiy tilda:** dastur ishlab turgani yetarli emas. Ishlamay qolganda buni bilish kerak, ma'lumot yo'qolsa tiklash kerak, birov parolni terib topishga urinsa to'sish kerak. Bular oldindan qilinmasa, muammo chiqqanda kech bo'ladi.

**Ishlar:**
- Har servis "tirikman" deb javob berishi
- Bog'liqliklarni tekshiruvchi endpoint (baza, navbat)
- Birinchi ishga tushirishda kerakli ma'lumot (bosh admin, kategoriyalar)
- Ma'lumotlar bazasi zaxirasi va uni tiklab ko'rish
- So'rovlar sonini cheklash (parol terishga qarshi)
- Production sozlamalari faylini tekshirish

**Tayyor deb hisoblanadi:** sog'liq tekshiruvi javob beradi, zaxira olinadi va tiklanadi, cheklov ishlaydi.`,
};
