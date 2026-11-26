import * as Joi from 'joi';

/**
 * Muhit o'zgaruvchilari sxemasi. Dastur ishga tushishida tekshiriladi —
 * majburiy (`required`) qiymat yo'q yoki noto'g'ri bo'lsa, dastur ishga tushmaydi
 * va aniq xato beradi (`abortEarly:false` — barcha xatolar birdan ko'rsatiladi).
 */
export const envValidationSchema = Joi.object({
  // Umumiy
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  API_GATEWAY_PORT: Joi.number().port().default(3000),
  CORS_ORIGINS: Joi.string().allow('').optional(),
  // `TRUST_PROXY_HOPS` endi o'qilmaydi: ishonchli proksilar tarmoq bo'yicha
  // aniqlanadi (apps/api-gateway/src/trust-proxy.ts). Eski env faylida qolsa
  // ham xato bermaydi — noma'lum kalitlarga ruxsat bor.

  // Rate limiting — umumiy chegara. Auth kabi nozik endpointlarda controller
  // darajasida @Throttle bilan qattiqroq limit qo'yiladi.
  RATE_LIMIT_WINDOW_MS: Joi.number().integer().min(1000).default(60000),
  RATE_LIMIT_MAX: Joi.number().integer().min(1).default(300),
  // BE-36: bir nechta nusxa (gateway, lead-service) uchun umumiy so'rov chegarasi. Berilmasa — har nusxa o'z
  // xotirasida sanaydi (ishga tushishda bitta nusxa). Redis uzilsa ham so'rovlar to'xtamaydi.
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .empty('')
    .optional(),

  // Migratsiya konteyner ko'tarilishida avtomat ishlasinmi. Productionda
  // nazoratli rollout uchun `false` qilib, alohida qadamda ishga tushiriladi.
  DB_AUTO_MIGRATE: Joi.boolean().default(true),

  // Birinchi deploy uchun idempotent seed.
  SEED_ADMIN_PHONE: Joi.string()
    .pattern(/^\+998\d{9}$/)
    .optional(),
  SEED_ADMIN_PASSWORD: Joi.string().min(4).optional(),
  SEED_DEFAULT_CATEGORIES: Joi.boolean().default(false),

  // PostgreSQL
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),

  // RabbitMQ
  RABBITMQ_URL: Joi.string()
    .uri({ scheme: ['amqp', 'amqps'] })
    .required(),

  // MinIO
  MINIO_ENDPOINT: Joi.string().required(),
  MINIO_PORT: Joi.number().port().default(9000),
  MINIO_USE_SSL: Joi.boolean().default(false),
  MINIO_ACCESS_KEY: Joi.string().required(),
  MINIO_SECRET_KEY: Joi.string().required(),
  MINIO_BUCKET: Joi.string().default('marketplace-media'),
  MINIO_PUBLIC_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required(),
  // BE-08: kreativlar sozlamasi (fayl turi va hajm) [taklif]. Tur faqat ma’lum ro‘yxatdan — noma’lum tur jim
  // tushib qolib, ro‘yxat bo‘sh qolmasin.
  CREATIVE_VIDEO_TYPES: Joi.string()
    .pattern(/^\s*video\/(mp4|webm)\s*(,\s*video\/(mp4|webm)\s*)*$/i)
    .default('video/mp4,video/webm'),
  CREATIVE_VIDEO_MAX_MB: Joi.number().integer().min(1).max(2048).default(100),
  CREATIVE_IMAGE_TYPES: Joi.string()
    .pattern(/^\s*image\/(jpeg|png|webp)\s*(,\s*image\/(jpeg|png|webp)\s*)*$/i)
    .default('image/jpeg,image/png,image/webp'),
  CREATIVE_IMAGE_MAX_MB: Joi.number().integer().min(1).max(100).default(10),
  // Yuklash policy sini imzolovchi alohida MinIO kaliti (faqat `creative-uploads/*` ga yozish); bo‘sh — asosiy kalit
  CREATIVE_UPLOAD_ACCESS_KEY: Joi.string().allow('').optional(),
  CREATIVE_UPLOAD_SECRET_KEY: Joi.string().allow('').optional(),

  // Auth (JWT)
  JWT_SECRET: Joi.string().min(16).required(),
  JWT_EXPIRES_IN: Joi.string().default('1h'),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
  // false — login/register/refresh tokenni body'da qaytarmaydi, faqat
  // HttpOnly cookie'da (API_CONTRACT.md §2.2.1). Frontend cookie'ga o'tgach.
  AUTH_TOKENS_IN_BODY: Joi.boolean().default(true),

  // BE-26 (T8): admin va moliya uchun 2FA (TOTP). Yoqilganda sirlar kaliti majburiy — aks holda hamma admin
  // panelga kira olmay qoladi (birinchi kirishda 500).
  ADMIN_2FA: Joi.string().valid('on', 'off').default('off'),
  TWO_FACTOR_SECRET_KEY: Joi.string().min(32).when('ADMIN_2FA', {
    is: 'on',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  // BE-25 5-tur: sotuvchi JShShIR ini shifrlash kaliti (gateway va finance-service). Berilmasa ariza qabul qilinmaydi (503).
  // Bir marta qo‘yiladi: almashtirilsa eski JShShIR lar ochilmaydi.
  SELF_EMPLOYED_SECRET_KEY: Joi.string().min(32).allow('').optional(),
  // BE-26: prod’da Swagger sukut bo‘yicha yopiq; monitor ko‘rsatkichlari tokeni (gateway `health/ops`)
  SWAGGER_ENABLED: Joi.string().valid('on', 'off', 'true', 'false').optional(),
  MONITOR_TOKEN: Joi.string().min(16).optional(),

  // Integratsiya kalitlari shifri (AES)
  INTEGRATION_CREDENTIAL_SECRET: Joi.string().min(16).required(),

  // Elchi Partner API (elchi-integration servisi) — ixtiyoriy (faqat o'sha
  // servisga kerak; boshqa servislar bularsiz ham ishga tushadi).
  ELCHI_PARTNER_API_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .optional(),
  ELCHI_PARTNER_API_KEY: Joi.string().optional(),
  ELCHI_WEBHOOK_SECRET: Joi.string().min(16).optional(),

  // Notification provider adapterlari (ixtiyoriy)
  EMAIL_WEBHOOK_URL: Joi.string().uri().optional(),
  SMS_WEBHOOK_URL: Joi.string().uri().optional(),

  // BE-15: telefoniya provayderi (EQ-02). URL berilmasa qo'ng'iroq tugmasi o'chiq, natija qo'lda (BE-13 dagidek).
  TELEPHONY_API_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .allow('')
    .optional(),
  TELEPHONY_API_TOKEN: Joi.string().allow('').optional(),
  // provayder webhooki imzosi (X-Telephony-Signature, HMAC-SHA256)
  // URL bor, kalit yo'q bo'lsa hamma hodisa 401 bo'lib, qo'ng'iroqlar tugamay qolardi
  TELEPHONY_WEBHOOK_SECRET: Joi.string()
    .min(16)
    .when('TELEPHONY_API_URL', {
      is: Joi.string().uri().required(),
      then: Joi.required(),
      otherwise: Joi.optional().allow(''),
    }),
  // TEL-1: mijozga ko'rinadigan mahalliy raqam; berilmasa provayder o'zi tanlaydi
  TELEPHONY_CALLER_ID: Joi.string()
    .pattern(/^\+998\d{9}$/)
    .allow('')
    .optional(),
  // suhbatdan keyin yozuv shuncha daqiqada kelmasa — «yozuvsiz» (TEL-3) [taklif]
  TELEPHONY_RECORDING_GRACE_MINUTES: Joi.number()
    .integer()
    .min(1)
    .max(1440)
    .default(30),
  // BE-32: sotuvchi kartasiga to'lov provayderi (EQ-08). URL berilmasa kartaga avtomatik to'lov o'chiq —
  // moliya qo'lda «To'landi» bosadi (BE-23). O'zgaruvchilar finance-service va api-gateway ga kerak.
  PAYOUT_API_URL: Joi.string()
    .uri({ scheme: ['https', 'http'] })
    .allow('')
    .optional(),
  PAYOUT_API_TOKEN: Joi.string().allow('').optional(),
  // provayder webhooki imzosi (X-Payout-Signature, HMAC-SHA256); URL bor, kalit yo'q bo'lsa karta ulanmasdi va
  // to'lov natijasi kelmasdi
  PAYOUT_WEBHOOK_SECRET: Joi.string()
    .min(16)
    .when('PAYOUT_API_URL', {
      is: Joi.string().uri().required(),
      then: Joi.required(),
      otherwise: Joi.optional().allow(''),
    }),
  // karta tokenini shifrlash kaliti (bazada va navbatda ochiq token yo'q)
  PAYOUT_SECRET_KEY: Joi.string()
    .min(32)
    .when('PAYOUT_API_URL', {
      is: Joi.string().uri().required(),
      then: Joi.required(),
      otherwise: Joi.optional().allow(''),
    }),
  // karta ulangandan keyin provayder sotuvchini qaytaradigan sahifa (kabinet)
  PAYOUT_RETURN_URL: Joi.string()
    .uri({ scheme: ['https', 'http'] })
    .allow('')
    .optional(),
  TELEGRAM_BOT_TOKEN: Joi.string().optional(),

  // C4.2 — xaridor posilka yetkazilgandan keyin necha kun ichida qaytarish
  // so'rovi yubora oladi (O'zbekiston qonuni / Uzum: sifatli tovar — 10 kun).
  RETURN_WINDOW_DAYS: Joi.number().integer().min(1).max(365).default(10),
});
