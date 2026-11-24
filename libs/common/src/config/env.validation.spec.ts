import { envValidationSchema } from './env.validation';

describe('envValidationSchema — BE-08 kreativ fayl turlari', () => {
  const check = (key: string, value: string) =>
    envValidationSchema.extract(key).validate(value).error;

  it('ma’lum turlar (bo‘shliq va katta harf bilan ham) qabul qilinadi', () => {
    expect(
      check('CREATIVE_VIDEO_TYPES', 'video/mp4, video/webm'),
    ).toBeUndefined();
    expect(check('CREATIVE_VIDEO_TYPES', 'video/mp4')).toBeUndefined();
    expect(
      check('CREATIVE_IMAGE_TYPES', 'image/jpeg,IMAGE/PNG,image/webp'),
    ).toBeUndefined();
  });

  it('noma’lum yoki boshqa guruh turi — servis ishga tushmaydi (jim tushib qolmaydi)', () => {
    for (const value of [
      'video/quicktime',
      'video/mp4,video/quicktime',
      'image/png',
      'video/mp4,',
    ])
      expect(check('CREATIVE_VIDEO_TYPES', value)).toBeDefined();
    expect(check('CREATIVE_IMAGE_TYPES', 'image/gif')).toBeDefined();
    expect(check('CREATIVE_IMAGE_TYPES', 'video/mp4')).toBeDefined();
  });
});

describe('envValidationSchema — BE-15 telefoniya', () => {
  const required = {
    NODE_ENV: 'test',
    DB_HOST: 'x',
    DB_USERNAME: 'x',
    DB_PASSWORD: 'x',
    DB_NAME: 'x',
    RABBITMQ_URL: 'amqp://x:5672',
    MINIO_ENDPOINT: 'x',
    MINIO_ACCESS_KEY: 'access-key-1',
    MINIO_SECRET_KEY: 'secret-key-1',
    MINIO_PUBLIC_URL: 'http://x',
    JWT_SECRET: 'x'.repeat(32),
    JWT_REFRESH_SECRET: 'y'.repeat(32),
    INTEGRATION_CREDENTIAL_SECRET: 'z'.repeat(32),
  };
  const error = (over: Record<string, string>) =>
    envValidationSchema.validate(
      { ...required, ...over },
      { allowUnknown: true },
    ).error?.message;

  it('telefoniyasiz (yo‘q yoki bo‘sh) — sozlama talab qilinmaydi', () => {
    expect(error({})).toBeUndefined();
    expect(
      error({
        TELEPHONY_API_URL: '',
        TELEPHONY_API_TOKEN: '',
        TELEPHONY_WEBHOOK_SECRET: '',
        TELEPHONY_CALLER_ID: '',
      }),
    ).toBeUndefined();
  });

  it('URL bor — webhook kaliti majburiy (aks holda hodisalar 401 bo‘lib, qo‘ng‘iroqlar tugamaydi)', () => {
    const url = { TELEPHONY_API_URL: 'https://pbx.example.com/api' };
    expect(error(url)).toContain('TELEPHONY_WEBHOOK_SECRET');
    expect(error({ ...url, TELEPHONY_WEBHOOK_SECRET: '' })).toContain(
      'TELEPHONY_WEBHOOK_SECRET',
    );
    expect(error({ ...url, TELEPHONY_WEBHOOK_SECRET: 'qisqa' })).toContain(
      'TELEPHONY_WEBHOOK_SECRET',
    );
    expect(
      error({ ...url, TELEPHONY_WEBHOOK_SECRET: 'yetarli-uzun-kalit-1' }),
    ).toBeUndefined();
    expect(
      error({
        ...url,
        TELEPHONY_WEBHOOK_SECRET: 'yetarli-uzun-kalit-1',
        TELEPHONY_CALLER_ID: '+79001234567',
      }),
    ).toContain('TELEPHONY_CALLER_ID');
  });
});
