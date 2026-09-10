import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateAdminSettingsDto } from './admin-settings.dto';

describe('UpdateAdminSettingsDto (C6.2)', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true });

  it('to‘g‘ri qiymatlarni qabul qilib, sonlarni transform qiladi', async () => {
    await expect(
      pipe.transform(
        {
          commissionPercent: '7.5',
          minimumOrderAmount: '50000',
          supportPhone: '+998712000000',
        },
        { type: 'body', metatype: UpdateAdminSettingsDto },
      ),
    ).resolves.toMatchObject({
      commissionPercent: 7.5,
      minimumOrderAmount: 50000,
      supportPhone: '+998712000000',
    });
  });

  it.each([
    { commissionPercent: -1, minimumOrderAmount: 0, supportPhone: '' },
    { commissionPercent: 101, minimumOrderAmount: 0, supportPhone: '' },
    { commissionPercent: 5, minimumOrderAmount: -1, supportPhone: '' },
    { commissionPercent: 5, minimumOrderAmount: 0, supportPhone: '712000000' },
  ])('TC3: noto‘g‘ri qiymatni rad etadi: %j', async (value) => {
    await expect(
      pipe.transform(value, {
        type: 'body',
        metatype: UpdateAdminSettingsDto,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
