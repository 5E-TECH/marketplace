// ============================================================================
// Trello card tavsiflari — sodda, to'liq o'zbekcha (har kim bir o'qishda tushunsin).
// Kalit = card kodi (C0.1 ...). Testlar bu yerda YO'Q — ular card checklistida.
// trello-update-descriptions.mjs shu matnni Trello cardlarga yozadi + CSV'ni yangilaydi.
// ============================================================================
export default {

// ─── FAZA 0: Poydevor + setup ──────────────────────────────────────────────
"C0.0a": `**Maqsad:** Rejadagi barcha vazifalarni Trello'ga ko'chirib, jamoa ish boshlaydigan taxta tayyorlash.

Trello'da bitta board ochiladi, unga 5 ta ustun (Backlog, Doing, Testing, Done + kerak bo'lsa Review) qo'yiladi. \`trello-import.csv\` import qilinib, har bir card o'z egasiga, labeliga va muddatiga biriktiriladi. Jamoa a'zolari (Dilshodbek, Bahodir) boardga taklif qilinadi.

**Ishlar:**
- Board + ustunlar + label'lar (Phase, Area, Priority, Hajm) yaratish
- 77 card import qilish, har biriga a'zo/label/deadline biriktirish
- Jamoani boardga qo'shish`,

"C0.0b": `**Maqsad:** Saytning umumiy ko'rinishi (dizayn yo'nalishi) qanday bo'lishini oldindan belgilash — keyin frontend shu asosda quriladi.

Storefront (xaridor sayti) va sotuvchi kabineti uchun vizual uslub tanlanadi: rang palitrasi, shrift (tipografiya), tayyor UI kit yoki dizayn tizimi. Bir nechta asosiy ekran uchun mockup (chizma) tayyorlanadi va Lead tasdiqlaydi.

**Ishlar:**
- Referens saytlar to'plash, uslub tanlash
- Palitra (hex ranglar) + tipografiya hujjatlash
- UI kit/dizayn tizimi tanlash, 4+ ekran mockup, Lead approve`,

"C0.1": `**Maqsad:** Loyihaning bo'sh "skeleti" va lokal ishlash muhitini tayyorlash — hamma shu poydevor ustiga kod yozadi.

NestJS monorepo (bitta repo ichida ko'p servis) \`nest-cli\` bilan quriladi. \`docker-compose\` orqali lokal xizmatlar ko'tariladi: PostgreSQL (baza), RabbitMQ (servislararo xabar), MinIO (rasm saqlash), Adminer (bazani ko'rish). Sozlamalar \`.env\` orqali beriladi va Joi bilan tekshiriladi (kerakli sozlama yo'q bo'lsa dastur ishga tushmaydi).

**Ishlar:**
- Monorepo + apps/libs tuzilishi
- docker-compose (postgres/rabbitmq/minio/adminer)
- \`.env.example\` + Joi config validatsiya`,

"C0.2": `**Maqsad:** Barcha servislar birga ishlatadigan umumiy kod ("libs/common") ni tayyorlash — bir marta yozib, hamma joyda qayta ishlatiladi.

Elchi loyihasidan sinovdan o'tgan pattern'lar ko'chiriladi: BaseEntity (id, sana, soft-delete), yagona javob shakli \`{statusCode, message, data}\`, xatolarni ushlash, idempotency (bir amal ikki marta bajarilib qolmasligi), outbox (event ishonchli yuborilishi), activity-log, JWT/rol guard'lari, pul (numeric) transformeri, enum'lar, SSRF va HMAC yordamchilar.

**Ishlar:**
- BaseEntity, response envelope, executeAndAck
- idempotency, outbox, activity-log
- guards (JWT/Roles/Self), numericTransformer, enums, SSRF+HMAC helper`,

"C0.3": `**Maqsad:** Tashqi dunyoga qaraydigan yagona kirish nuqtasi (API Gateway) ni qurish — barcha so'rovlar shu yerdan o'tadi.

Gateway HTTP so'rovlarni qabul qilib, RabbitMQ orqali kerakli servisga uzatadi. Global tekshiruvlar (validatsiya, xato filtri, javob formati) shu yerda o'rnatiladi. JWT va rol tekshiruvi, Swagger (API hujjati) va \`/health\` (tiriklik) endpointi qo'shiladi.

**Ishlar:**
- HTTP→RabbitMQ ClientProxy
- Global pipe/interceptor/filter, JWT + RolesGuard
- Swagger hujjat, \`/health\``,

"C0.4": `**Maqsad:** Foydalanuvchilar (sotuvchi/xaridor/admin) va ularning tizimga kirishini (auth) yaratish.

identity-service \`users\` jadvalini boshqaradi. Ro'yxatdan o'tish va login qilish (parol bcrypt bilan shifrlanadi, JWT token beriladi) yoziladi. Rollar (SELLER/BUYER/ADMIN/SUPERADMIN) seed qilinadi. Gateway'da auth route'lari ulanadi.

**Ishlar:**
- \`users\` entity + migratsiya
- register/login (bcrypt + JWT), rol seed
- gateway auth route'lari`,

"C0.5": `**Maqsad:** Kod sifatini avtomat nazorat qilish va yangi dasturchi tez qo'shiladigan hujjat tayyorlash.

ESLint + Prettier (kod uslubi) + husky (commit oldidan tekshiruv) o'rnatiladi. GitHub Actions CI quriladi — har PR'da lint/build/test avtomat ishlaydi. CONTRIBUTING va README yoziladi (loyihani qanday ishga tushirish, qoidalar).

**Ishlar:**
- ESLint + Prettier + husky pre-commit
- GitHub Actions (lint/build/test)
- CONTRIBUTING + README`,

"C0.6": `**Maqsad:** Katalog ma'lumotlar bazasi jadvallarini yaratish (do'kon, kategoriya, mahsulot, variant).

catalog-service uchun 4 ta jadval va ularning migratsiyasi yoziladi: \`shop\` (do'kon), \`category\` (daraxt ko'rinishidagi kategoriyalar), \`product\` (mahsulot), \`product_variant\` (rang/o'lcham varianti). Do'kon slug'i va SKU takrorlanmasligi (unique) ta'minlanadi.

**Ishlar:**
- shop, category (self-ref daraxt), product, product_variant
- migratsiya + unique cheklovlar (slug, sku)`,

"C0.7": `**Maqsad:** Sklad (ombor/qoldiq) bazasi jadvallarini yaratish.

inventory-service uchun jadvallar: \`warehouse\` (ombor), \`stock\` (har variant×ombor uchun qoldiq, unique), \`stock_movement\` (har o'zgarish jurnali), \`reservation\` va \`reservation_item\` (buyurtma uchun band qilingan tovar). Migratsiya yoziladi.

**Ishlar:**
- warehouse, stock (uniq variant+warehouse), stock_movement, reservation(+item)
- migratsiya + unique cheklovlar`,

"C0.8": `**Maqsad:** Skladning eng muhim mantig'i — tovarni band qilish/berish, hech qachon "yo'q tovarni sotib qo'ymaslik".

Bitta tranzaksiya ichida \`SELECT ... FOR UPDATE\` bilan qoldiq qulflanadi va invariant saqlanadi: \`bor − band ≥ 0\` (ya'ni hech qachon manfiy bo'lmaydi). Amallar: **reserve** (band qilish), **commit** (sotildi, kamaytirish), **release** (bekor, qaytarish), **inbound** (kirim), **adjust** (tuzatish). Har amal jurnalga yoziladi, idempotency bilan takror bajarilmaydi.

**Ishlar:**
- reserve/commit/release/inbound/adjust (tranzaksiya + FOR UPDATE)
- invariant on_hand−reserved≥0, movement jurnal, idempotency`,

"C0.9": `**Maqsad:** Band qilingan, lekin to'lanmagan tovarni avtomat bo'shatish va tugagan tovarni "sotuvda yo'q" qilish.

Cron (vaqti-vaqti bilan ishlaydigan) vazifa: muddati o'tgan (\`held\` va \`expires < hozir\`) rezervlarni topib \`release\` qiladi. Qoldiq 0 ga tushsa, mahsulot avtomat \`OUT_OF_STOCK\` bo'ladi (catalog'ga event yuboriladi).

**Ishlar:**
- TTL sweeper cron: muddati o'tgan reservni bo'shatish
- qoldiq 0 → out_of_stock event`,

"C0.10": `**Maqsad:** Sklad mantig'i xatosiz ishlashini avtomat testlar bilan kafolatlash.

Turli holatlar uchun testlar yoziladi: oddiy oqim, "ortiqcha sotib bo'lmasligi" (oversell imkonsiz), bir vaqtda ko'p so'rov (concurrency), idempotency, TTL. CI'da hammasi yashil bo'lishi kerak.

**Ishlar:**
- happy-path, oversell, concurrency, idempotency, TTL testlari
- CI yashil`,

"C0.11": `**Maqsad:** Sotuvchi kabineti (frontend) loyihasini boshlash.

Vite + React 19 + TypeScript asosida loyiha quriladi. antd (UI kutubxona), Redux Toolkit (holat), react-query (server ma'lumoti), router qo'shiladi. C0.0b dagi dizayn tokenlari (rang/shrift) ulanadi.

**Ishlar:**
- Vite + React 19 + TS + antd + RTK + react-query + router
- dizayn tokenlari ulanishi`,

"C0.12": `**Maqsad:** Frontendda tizimga kirish (auth) poydevorini qurish.

Axios interceptor (har so'rovga token qo'shadi, 401 bo'lsa logout), authSlice (token saqlash, sahifa yangilanganda ham qolishi), ProtectedRoute (tokensiz sahifalarga kirmaslik), react-query sozlamasi.

**Ishlar:**
- Axios interceptor (token/401)
- authSlice + persist, ProtectedRoute`,

"C0.13": `**Maqsad:** Kabinetning umumiy ko'rinishi (layout) va dizayn uslubini o'rnatish.

Chap menyu (sidebar) + tepa panel (header), antd theme (rang/uslub), responsive (telefon/planshet), breadcrumb (qayerdaligini ko'rsatuvchi yo'l).

**Ishlar:**
- Sidebar + header + breadcrumb
- antd theme, responsive (375px'da ham buzilmaydi)`,

"C0.14": `**Maqsad:** Ko'p joyda ishlatiladigan tayyor komponentlarni bir marta yozib qo'yish.

Umumiy komponentlar: DataTable (jadval — sahifalash/saralash/qidiruv), FormModal, ConfirmDialog (tasdiq oynasi), ImageUpload (rasm yuklash), StatusTag, MoneyText (pulni chiroyli ko'rsatish: 1 234 567), EmptyState.

**Ishlar:**
- DataTable, FormModal, ConfirmDialog
- ImageUpload, StatusTag, MoneyText, EmptyState`,

"C0.15": `**Maqsad:** Ro'yxatdan o'tish va login sahifalarini yasash.

Register sahifasi (maydonlar + validatsiya), Login sahifasi. Muvaffaqiyatli kirgach token olinadi va foydalanuvchi dashboardga yo'naltiriladi.

**Ishlar:**
- Register (validatsiya) + Login sahifalari
- token → redirect (dashboard)`,

// ─── FAZA 1: Sotuvchi kabineti (MVP) ───────────────────────────────────────
"C1.1": `**Maqsad:** Elchi tomonda marketplace'ni tanish uchun "hamkor" (partner) ma'lumotlarini saqlash.

Elchi-Backend'da \`partner\` jadvali qo'shiladi: api kalit hash'i, webhook manzili, HMAC secret (AES bilan shifrlangan), aktivligi. Marketplace shu kalit orqali Elchi API'siga murojaat qiladi. Migratsiya yoziladi, mavjud Elchi testlari buzilmasligi kerak.

**Ishlar:**
- partner entity (api_key_hash, webhook_url, secret AES, is_active) + partner_shipment_ref
- migratsiya, secret shifrlangan holda`,

"C1.2": `**Maqsad:** Elchi Partner API'ga faqat to'g'ri kalit bilan kirishni ta'minlash.

\`X-Api-Key\` header'i tekshiriladi (PartnerApiKeyGuard) — kalit bazadagi hamkorga mos bo'lsa \`req.partner\` to'ldiriladi. Controller, Swagger va rate-limit qo'shiladi. Bu JWT emas, alohida API-key mexanizmi.

**Ishlar:**
- PartnerApiKeyGuard (X-Api-Key → validate → req.partner)
- controller + Swagger + rate-limit`,

"C1.3": `**Maqsad:** Hamkorlarni va ularning kalitlarini boshqarish (yaratish/yangilash).

Partner CRUD: yaratish, kalitni yangilash (rotate), aktivlashtirish. Kalit hash sifatida saqlanadi, secret AES bilan shifrlanadi, har amal activity-log'ga yoziladi. Yangi kalit faqat bir marta ko'rsatiladi.

**Ishlar:**
- create/rotate/activate, kalit hash, secret AES
- activity-log`,

"C1.4": `**Maqsad:** Marketplace'ga Elchi'ning hudud (region/tuman) va tarif ma'lumotlarini ochish.

Elchi'ning ichki logistika ma'lumotlari (regionlar, tumanlar, yetkazish tarifi) Partner API orqali "passthrough" qilinadi — marketplace shu ro'yxatlarni oladi (manzil tanlash uchun).

**Ishlar:**
- regions / districts / tariff endpointlari (passthrough)`,

"C1.5": `**Maqsad:** Har bir sotuvchi uchun Elchi tizimida alohida "market" akkaunt ochish (pul va posilka shu akkauntga bog'lanadi).

Partner API'da \`POST /partner/markets\` yoziladi — u Elchi'da market + kassa (cashbox) yaratadi. Idempotent: bir sotuvchi uchun ikki marta chaqirilsa, yangi market ochilmaydi (\`external_seller_id\` bo'yicha). Javobda \`elchi_market_id\` qaytadi.

**Ishlar:**
- market + cashbox provision (idempotent external_seller_id)
- javobda elchi_market_id`,

"C1.6": `**Maqsad:** Marketplace tomonda Elchi bilan gaplashadigan mijoz (client) kodini yozish.

Sotuvchi approve bo'lganda elchi-integration \`POST /partner/markets\` chaqiradi va qaytgan \`elchi_market_id\` ni \`shop\`ga yozadi. Geo ma'lumot keshlanadi, kalit AES bilan saqlanadi, xatoda qayta urinadi (retry — lekin 2 marta market ochilmaydi).

**Ishlar:**
- approve → market provision → shop.elchi_market_id
- geo_cache sync, AES kalit, retry`,

"C1.7": `**Maqsad:** Adminga do'konlarni ko'rish va tasdiqlash/rad etish imkonini berish (backend).

\`GET /admin/shops\` (filtrlash bilan), \`approve\` (do'konni aktiv qiladi + default ombor + Elchi market provision), \`reject\`, va sotuvchiga xabar (notify). Faqat admin kira oladi.

**Ishlar:**
- GET /admin/shops (status filtr)
- approve (active + warehouse + provision), reject + notify`,

"C1.8": `**Maqsad:** Sotuvchi o'zini ro'yxatdan o'tkazganda foydalanuvchi va do'kon birga (atomik) yaratilishi.

\`POST /sellers/register\` — bitta tranzaksiyada \`user(SELLER, inactive)\` va \`shop(PENDING)\` yaratiladi. Biri xato bo'lsa ikkalasi bekor bo'ladi (rollback). Adminga xabar boradi, takroriy telefon tekshiriladi.

**Ishlar:**
- user + shop atomik yaratish (rollback bilan)
- admin notify, dublikat telefon tekshiruvi`,

"C1.9": `**Maqsad:** Sotuvchi o'z do'koni profilini ko'rishi va tahrirlashi.

\`GET /sellers/me\` va \`PATCH /sellers/me\`. SelfGuard bilan himoyalanadi — sotuvchi faqat o'z do'konini ko'radi/tahrirlaydi, boshqasiniki 403.

**Ishlar:**
- GET/PATCH shop profil
- SelfGuard (o'zganiki 403)`,

"C1.10": `**Maqsad:** Kategoriyalarni boshqarish (admin) va ochiq daraxt ko'rinishida berish.

Admin kategoriya CRUD qiladi (slug takrorlanmaydi). Ommaga (public) kategoriyalar daraxt (ierarxik) ko'rinishida beriladi.

**Ishlar:**
- admin CRUD (slug uniq)
- public tree (ierarxik ro'yxat)`,

"C1.11": `**Maqsad:** Mahsulotlarni to'liq boshqarish (sotuvchi).

Boy Product CRUD: slug, tavsif, narx, atributlar, status. \`/products/my\` — sotuvchi faqat o'z mahsulotlarini ko'radi (filtr bilan). Egalik tekshiriladi — boshqaning mahsulotini tahrirlab/o'chirib bo'lmaydi.

**Ishlar:**
- CRUD (slug avtomat, narx/nom validatsiya)
- /products/my (filtr), ownership (403)`,

"C1.12": `**Maqsad:** Mahsulot variantlarini (rang/o'lcham) boshqarish.

Variant CRUD: sku, atributlar, narx, barcode. Variantsiz mahsulotga ham avtomat bitta "default" variant yaratiladi. SKU takrorlanmaydi.

**Ishlar:**
- variant CRUD (sku uniq)
- variantsizga default variant avtomat`,

"C1.13": `**Maqsad:** Rasm/media yuklash xizmatini yaratish (MinIO).

file-service MinIO bucket va URL beradi. \`POST /files/upload\` — fayl validatsiya bilan (format/hajm) yuklanadi, mahsulotga bir nechta rasm (images jsonb) va cover biriktiriladi.

**Ishlar:**
- MinIO bucket + URL
- /files/upload (validatsiya), images jsonb + cover`,

"C1.14": `**Maqsad:** Omborlar va qoldiqni ko'rish (sotuvchi).

Ombor CRUD, qoldiqni ko'rish (\`GET /stock\`), kam qolgan tovarlar (\`/stock/low\`). Sotuvchi faqat o'z do'koni ma'lumotini ko'radi.

**Ishlar:**
- warehouses CRUD (birinchi = default)
- GET stock, /stock/low (threshold ostidagilar)`,

"C1.15": `**Maqsad:** Sotuvchi qo'lda tovar kirim qilishi va qoldiqni tuzatishi.

\`inbound\` (kirim, +) va \`adjust\` (tuzatish, sabab bilan) endpointlari. Har amal \`stock_movement\` jurnaliga actor bilan yoziladi. Boshqaning ombori 403.

**Ishlar:**
- inbound + adjust (sabab) → movement jurnal
- boshqa ombor 403`,

"C1.16": `**Maqsad:** Sotuvchiga o'z buyurtmalari va statistikasini ko'rsatish.

\`/seller/orders\` — sotuvchi buyurtmalari (Elchi statusi bilan). \`/seller/dashboard\` — jamlangan ko'rsatkichlar (sotuv, daromad va h.k.). Buyurtma bo'lmasa bo'sh/0 (xato emas).

**Ishlar:**
- /seller/orders (faqat o'ziniki)
- /seller/dashboard (aggregate)`,

"C1.17": `**Maqsad:** Bildirishnoma (xabar) xizmatini yaratish.

notification-service: \`notification\` jadvali + in-app + adapter (email/telegram/sms). Muhim hodisalarda (ro'yxat, approve, buyurtma) xabar yoziladi va yuboriladi; adapter xatosida qayta urinadi.

**Ishlar:**
- notification entity + in-app + adapter (email/tg/sms)
- eventlar → notification, retry`,

"C1.18": `**Maqsad:** Do'kon profili sahifasi (frontend).

Sotuvchi do'kon ma'lumotini ko'radi/tahrirlaydi, logo va banner yuklaydi, saqlaydi.

**Ishlar:**
- ko'rish/tahrir, logo/banner upload, save`,

"C1.19": `**Maqsad:** Mahsulotlar ro'yxati sahifasi (frontend).

Jadval: qidiruv, filtr, status, sahifalash. Tez amallar (o'chirish/tahrir), react-query cache.

**Ishlar:**
- jadval (search/filter/status/pagination)
- tez amallar, delete → tasdiq`,

"C1.20": `**Maqsad:** Mahsulot qo'shish/tahrirlash formasi (frontend).

Boy forma (nom, tavsif, narx, kategoriya, atribut), rasm yuklash. Yangi mahsulot saqlanadi yoki mavjudi yangilanadi, majburiy maydonlar validatsiya qilinadi.

**Ishlar:**
- boy forma + rasm upload
- create/update, validatsiya, kategoriya select`,

"C1.21": `**Maqsad:** Variantlarni boshqarish interfeysi (frontend).

Variant qo'shish/tahrirlash/o'chirish jadvali; variantsiz holat uchun default.

**Ishlar:**
- variant qo'shish/tahrir/o'chirish jadvali
- variantsizda default`,

"C1.22": `**Maqsad:** Ko'p rasm yuklash interfeysi (frontend).

Drag-and-drop bilan bir nechta rasm, tartibni o'zgartirish, cover (asosiy rasm) belgilash, yuklash progressi.

**Ishlar:**
- ko'p rasm drag-drop, tartib/cover, progress`,

"C1.23": `**Maqsad:** Omborlar sahifasi (frontend).

Omborlar ro'yxati, yangi ombor qo'shish, default belgilash.

**Ishlar:**
- list/create, default (bitta default)`,

"C1.24": `**Maqsad:** Qoldiq (stock) sahifasi (frontend).

Qoldiq jadvali, kirim/tuzatish modal oynasi, kam qolgan tovar ajratib ko'rsatiladi.

**Ishlar:**
- qoldiq jadval, inbound/adjust modal, low-stock highlight`,

"C1.25": `**Maqsad:** Buyurtmalar sahifasi (frontend).

Buyurtmalar ro'yxati + Elchi status timeline (yo'nalish tarixi), filtr.

**Ishlar:**
- list + Elchi status timeline, filter`,

"C1.26": `**Maqsad:** Statistika (dashboard) sahifasi (frontend).

Ko'rsatkich kartalari, grafik, top mahsulotlar. Ma'lumot bo'lmasa ham chiroyli ko'rinadi.

**Ishlar:**
- kartalar, chart, top mahsulot`,

"C1.27": `**Maqsad:** Admin do'kon moderatsiyasi interfeysi (frontend).

Kutilayotgan (pending) do'konlar ro'yxati, batafsil ko'rish + approve/reject, status o'zgarishi.

**Ishlar:**
- pending list, detail + approve/reject, status`,

// ─── FAZA 2: Storefront + checkout ─────────────────────────────────────────
"C2.1": `**Maqsad:** Marketplace buyurtmasini Elchi'ga posilka (shipment) sifatida yuborish.

Partner API'da \`POST /partner/shipments\` yoziladi — u Elchi'da \`order.create\` qiladi. Online to'lovda \`cod_amount=0\` (oldindan to'langan, kuryer pul yig'maydi), COD'da \`cod_amount=subtotal\`. Idempotent.

**Ishlar:**
- shipment → order.create, cod_amount mantiqi
- idempotent (2x → yangi yo'q)`,

"C2.2": `**Maqsad:** Posilkani ko'rish va bekor qilish (Elchi tomon).

\`GET /:id\` (status/tracking/cod), \`POST /cancel\`. Yetkazib bo'lingan posilkani bekor qilib bo'lmaydi (409).

**Ishlar:**
- GET shipment, POST cancel
- yetkazilganni cancel → 409`,

"C2.3": `**Maqsad:** Elchi statusi o'zgarganda marketplace'ga xabar yuborish (outbound webhook).

Status o'zgarishi outbox orqali marketplace webhook manziliga HMAC imzo bilan POST qilinadi. Xatoda backoff bilan qayta urinadi, muvaffaqiyatda takrorlanmaydi (dedup). "sold" da yig'ilgan pul (cod_collected) uzatiladi.

**Ishlar:**
- status event → outbox → HMAC POST, backoff retry
- dedup, sold → cod_collected`,

"C2.4": `**Maqsad:** Elchi'dan kelgan status xabarini marketplace qabul qilib, buyurtmani yangilashi.

Webhook receiver HMAC imzoni tekshiradi, \`sales_order_seller\` statusini yangilaydi. "returned" bo'lsa tovar skladga qaytadi (inbound), "delivered" + online bo'lsa payout ishga tushadi. Bir xabar 2 marta kelsa bir marta ishlaydi (idempotent).

**Ishlar:**
- HMAC verify → status mirror
- returned → inbound, delivered+online → payout, idempotent`,

"C2.5": `**Maqsad:** Elchi buyurtmasidagi tovar Elchi katalogiga bog'liq bo'lmasligi.

Elchi shipment item'i faqat nom/miqdorni oladi (\`product_id\` majburiy emas). Bu Elchi'ning ichki oqimini buzmasligi kerak (regressiya yashil).

**Ishlar:**
- external item (product_id null) → order yaratiladi
- internal oqim buzilmaydi`,

"C2.6": `**Maqsad:** Xaridorlar uchun ochiq katalog endpointlari.

Ommaviy ro'yxat (filtr/saralash/sahifalash), mahsulot batafsil, do'kon sahifasi. Faqat aktiv narsalar ko'rinadi (draft/suspended yashirin).

**Ishlar:**
- list (filter/sort/pagination), product detail, shop page
- faqat active`,

"C2.7": `**Maqsad:** Qidiruv xizmatini yaratish.

search-service: indeks, qidiruv + facet (filtr), yangi/o'zgargan mahsulot event bilan qayta indekslanadi.

**Ishlar:**
- index, search + facet
- reindex on event`,

"C2.8": `**Maqsad:** Savat (cart) xizmatini yaratish.

Savat + item (qo'shish/o'zgartirish/o'chirish), narx snapshot (o'sha paytdagi narx saqlanadi). Anonim va login qilgan xaridor uchun; login qilganda anon savat birlashtiriladi (merge).

**Ishlar:**
- cart + item, narx snapshot
- anon + logged (login'da merge)`,

"C2.9": `**Maqsad:** Buyurtma berish (checkout) va ko'p sotuvchini ajratish.

Savat \`shop_id\` bo'yicha guruhlanadi → har sotuvchiga alohida sub-buyurtma. Tovar 30 daqiqaga band qilinadi (reserve). Qoldiq yetmasa buyurtma yaratilmaydi (400). Online → \`pending_payment\`, COD → \`draft\`.

**Ishlar:**
- shop_id guruh → N sub-order
- reserve (ttl=30daq), qoldiq yetmasa 400`,

"C2.10": `**Maqsad:** COD buyurtmani tasdiqlab, har sotuvchi uchun Elchi posilkasini ochish.

Har sub-buyurtma uchun shipment yaratiladi (\`cod=subtotal\`), tovar commit qilinadi (qoldiq kamayadi), buyurtma \`confirmed\` bo'ladi, xabar yuboriladi. Shipment xato bo'lsa hammasi bekor (rollback).

**Ishlar:**
- har seller → shipment, inventory.commit
- confirmed + notify, xatoda rollback`,

"C2.11": `**Maqsad:** Buyurtma statusini Elchi bilan sinxron qilish va qaytishlarni boshqarish.

Elchi webhook → status yangilanadi; "returned" → tovar skladga qaytadi; sotuvchi buyurtmalarida haqiqiy status ko'rinadi.

**Ishlar:**
- webhook → status mirror
- returned → inbound, seller orders real status`,

"C2.12": `**Maqsad:** Xaridor sayti (storefront) loyihasini boshlash (Next.js).

SSR (serverda render — SEO uchun), layout/SEO/sitemap, API client sozlanadi.

**Ishlar:**
- SSR, layout/SEO/sitemap, API client`,

"C2.13": `**Maqsad:** Bosh sahifa va katalog ro'yxati (frontend).

Bosh sahifa + kategoriyalar, mahsulot listing (filtr/saralash/sahifalash SSR bilan), qidiruv.

**Ishlar:**
- bosh + kategoriya, listing (SSR, URL query), qidiruv`,

"C2.14": `**Maqsad:** Mahsulot batafsil sahifasi (frontend).

Rasm galereyasi, variant tanlash (narx/rasm yangilanadi), savatga qo'shish, SEO meta.

**Ishlar:**
- galereya, variant, savatga qo'shish, og/schema meta`,

"C2.15": `**Maqsad:** Do'kon sahifasi (frontend).

Do'kon header'i, uning mahsulotlari, \`/shop/[slug]\` route. Noto'g'ri slug → 404.

**Ishlar:**
- shop header + mahsulotlar, slug route (404)`,

"C2.16": `**Maqsad:** Savat sahifasi (frontend).

Ko'p sotuvchi bo'yicha guruhlangan savat, miqdor o'zgartirish/o'chirish, jami hisob.

**Ishlar:**
- sotuvchi bo'yicha guruh, qty/o'chirish, jami`,

"C2.17": `**Maqsad:** Buyurtma rasmiylashtirish sahifasi (frontend).

Manzil (region/tuman), to'lov usuli, har sotuvchi uchun alohida posilka preview, buyurtma berish.

**Ishlar:**
- manzil + to'lov usuli
- per-seller posilka preview, buyurtma → tasdiq`,

"C2.18": `**Maqsad:** Buyurtma tasdiqi va kuzatuv sahifasi (frontend).

Tasdiq (raqam + posilkalar), har posilka statusi/tracking.

**Ishlar:**
- tasdiq, posilka status/tracking`,

// ─── FAZA 3: Online to'lov ─────────────────────────────────────────────────
"C3.1": `**Maqsad:** To'lov xizmatining poydevorini qurish.

payment-service: \`payment\`/\`transaction\`/\`provider_config\` (AES). \`payment.create\`. Tashqi URL SSRF-guard bilan himoyalanadi.

**Ishlar:**
- payment/txn/provider_config (AES)
- payment.create, SSRF-guard`,

"C3.2": `**Maqsad:** Payme to'lovini ulash (JSON-RPC).

Payme Merchant API 6 metodi (CheckPerform/Create/Perform/Cancel/CheckTransaction/GetStatement), Basic auth, state → transaction, sandbox'da sinov.

**Ishlar:**
- 6 metod, Basic auth, state → txn
- sandbox test`,

"C3.3": `**Maqsad:** Click to'lovini ulash (Prepare/Complete).

Click Prepare + Complete, \`sign_string\` (md5) tekshiruvi, sandbox'da sinov.

**Ishlar:**
- prepare + complete, md5 sign
- sandbox test`,

"C3.4": `**Maqsad:** To'lov muvaffaqiyatli bo'lganda buyurtmani avtomat tasdiqlash (online).

\`payment.paid\` eventida \`confirmSalesOrder()\` chaqiriladi: shipment (cod=0, prepaid) ochiladi, tovar commit qilinadi. To'lov muvaffaqiyatsiz bo'lsa confirm bo'lmaydi, TTL tovarni bo'shatadi.

**Ishlar:**
- paid → confirm (cod=0 prepaid) + commit
- fail → confirm yo'q, TTL bo'shatadi`,

"C3.5": `**Maqsad:** Sotuvchi puli hisob-kitobi (escrow → payout).

finance-service: ledger/payout/commission. "delivered" bo'lganda ledger yoziladi va payout tayyorlanadi; komissiya (foiz/fiks) hisoblanadi. Payout ikki marta bajarilmaydi (idempotent); refund teskari yozuv beradi.

**Ishlar:**
- ledger/payout/commission
- delivered → ledger → payout, percent/fixed`,

"C3.6": `**Maqsad:** Pulni qaytarish (refund) oqimi.

Bekor yoki "returned" bo'lganda refund qilinadi (Payme Cancel), tovar skladga qaytadi (inbound), ledger'da refund yozuvi.

**Ishlar:**
- Cancel/returned → refund
- inventory.inbound, ledger refund`,

"C3.7": `**Maqsad:** To'lovni checkout'ga ulash (frontend).

Payme/Click'ga yo'naltirish (redirect), qaytish (return) callback, holatni ko'rsatish.

**Ishlar:**
- Payme/Click redirect, return callback, holat`,

"C3.8": `**Maqsad:** To'lov holati sahifasi (frontend).

Muvaffaqiyat/xato/kutish holatlari, buyurtmaga qaytish havolasi.

**Ishlar:**
- success/fail/pending, buyurtmaga qaytish`,

"C3.9": `**Maqsad:** Sotuvchi moliyasi sahifasi (frontend).

Ledger/balans, payout tarixi, komissiya ko'rinishi.

**Ishlar:**
- ledger/balans, payout tarixi, komissiya`,

// ─── FAZA 4: Sayqal + deploy ───────────────────────────────────────────────
"C4.1": `**Maqsad:** Sharh va reyting tizimi.

Faqat yetkazib olingan (delivered) xaridor sharh qoldiradi; sharh do'kon/mahsulot reytingini qayta hisoblaydi; ikki marta sharh mumkin emas. Frontend ham qo'shiladi.

**Ishlar:**
- review (delivered) + rating aggregate + FE`,

"C4.2": `**Maqsad:** Qaytarish/refund interfeysi (frontend).

Xaridor qaytarish so'rovi, sotuvchi/admin ko'radi, status oqimi.

**Ishlar:**
- buyer so'rov, seller/admin ko'rish, status oqimi`,

"C4.3": `**Maqsad:** COD komissiyasini hisob-kitob qilish (reconciliation).

Elchi "settled" bo'lganda COD ledger yoziladi, komissiya online payout'dan netting (ushlab qolish) yoki invoys bilan undiriladi, recon hisobotda farq 0 bo'lishi kerak.

**Ishlar:**
- settled → COD ledger
- netting/invoys, recon (farq=0)`,

"C4.4": `**Maqsad:** Admin analitika paneli (frontend).

GMV (umumiy aylanma), buyurtmalar, top mahsulotlar, grafiklar, sana filtri.

**Ishlar:**
- GMV/orders/top + grafiklar + sana filtri`,

"C4.5": `**Maqsad:** Admin moderatsiyani kengaytirish.

Do'konni to'xtatish (suspend)/qayta yoqish, mahsulot moderatsiyasi, audit log. Suspend bo'lganda mahsulotlar storefront'dan yo'qoladi.

**Ishlar:**
- suspend/reactivate, product moderatsiya, audit log`,

"C4.6": `**Maqsad:** To'liq oqimni tekshirish va tizimni ishlab chiqarishga (prod) chiqarish.

E2E smoke test (ro'yxatdan to'lov/payout gacha uzilishsiz), prod deploy + domen + TLS (HTTPS), monitoring/alert, DB backup+restore.

**Ishlar:**
- E2E smoke, prod deploy + TLS
- monitoring/alert, backup+restore`,

};
