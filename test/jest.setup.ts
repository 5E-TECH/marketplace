/**
 * Jest testlari real `.env`, Docker yoki CI secretlariga bog‘liq bo‘lmasligi kerak.
 * Qiymatlar faqat config validatsiyasidan o‘tish uchun ishlatiladi; tashqi servisga
 * ulanish amalga oshirilmaydi.
 */
const testEnv: Record<string, string> = {
  NODE_ENV: 'test',
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USERNAME: 'test',
  DB_PASSWORD: 'test',
  DB_NAME: 'marketplace_test',
  RABBITMQ_URL: 'amqp://guest:guest@localhost:5672',
  MINIO_ENDPOINT: 'localhost',
  MINIO_PORT: '9000',
  MINIO_USE_SSL: 'false',
  MINIO_ACCESS_KEY: 'test',
  MINIO_SECRET_KEY: 'test',
  MINIO_PUBLIC_URL: 'http://localhost:9000',
  JWT_SECRET: 'test_access_secret_min16',
  JWT_REFRESH_SECRET: 'test_refresh_secret_min16',
  INTEGRATION_CREDENTIAL_SECRET: 'test_integration_secret_min16',
};

for (const [key, value] of Object.entries(testEnv)) {
  process.env[key] ??= value;
}
