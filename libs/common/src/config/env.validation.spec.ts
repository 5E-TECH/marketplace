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
