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
  // Reverse proxy (Caddy) qatlamlari soni — haqiqiy mijoz IP'sini aniqlash
  // uchun. Bu bo'lmasa rate limit hamma foydalanuvchini bitta IP deb sanaydi.
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).default(1),

  // Rate limiting — umumiy chegara. Auth kabi nozik endpointlarda controller
  // darajasida @Throttle bilan qattiqroq limit qo'yiladi.
  RATE_LIMIT_WINDOW_MS: Joi.number().integer().min(1000).default(60000),
  RATE_LIMIT_MAX: Joi.number().integer().min(1).default(300),

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

  // Auth (JWT)
  JWT_SECRET: Joi.string().min(16).required(),
  JWT_EXPIRES_IN: Joi.string().default('1h'),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

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
  TELEGRAM_BOT_TOKEN: Joi.string().optional(),
});
