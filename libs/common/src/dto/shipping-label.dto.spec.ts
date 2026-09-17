import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ShippingLabelsBatchDto } from './seller.dto';

describe('ShippingLabelsBatchDto (C1.45)', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true });

  it('1–100 ta noyob order ID qabul qiladi', async () => {
    await expect(
      pipe.transform(
        { orderIds: ['101', '102'] },
        { type: 'body', metatype: ShippingLabelsBatchDto },
      ),
    ).resolves.toMatchObject({ orderIds: ['101', '102'] });
  });

  it.each([
    { orderIds: [] },
    { orderIds: ['101', '101'] },
    { orderIds: ['abc'] },
    { orderIds: Array.from({ length: 101 }, (_, index) => String(index + 1)) },
  ])('noto‘g‘ri batchni rad etadi', async (body) => {
    await expect(
      pipe.transform(body, {
        type: 'body',
        metatype: ShippingLabelsBatchDto,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
