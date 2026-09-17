import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateShopTariffsDto } from './admin-shop.dto';

describe('UpdateShopTariffsDto (C1.46)', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true });

  it('TC4: uy va markaz tariflarini alohida qabul qiladi', async () => {
    await expect(
      pipe.transform(
        { tariffHome: '25000', tariffCenter: '15000' },
        { type: 'body', metatype: UpdateShopTariffsDto },
      ),
    ).resolves.toMatchObject({ tariffHome: 25000, tariffCenter: 15000 });
  });

  it.each([
    { tariffHome: 0, tariffCenter: 15000 },
    { tariffHome: 25000, tariffCenter: 0 },
    { tariffHome: -1, tariffCenter: 15000 },
  ])('TC1: nol yoki manfiy tarifni rad etadi: %j', async (body) => {
    await expect(
      pipe.transform(body, {
        type: 'body',
        metatype: UpdateShopTariffsDto,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
