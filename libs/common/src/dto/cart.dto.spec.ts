import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  CheckoutPaymentMethod,
  CreateCheckoutDto,
  DeliveryPreviewDto,
  MAX_CHECKOUT_CART_ITEMS,
} from './cart.dto';

describe('CreateCheckoutDto / DeliveryPreviewDto — cartItemIds', () => {
  // main.ts dagi global pipe bilan bir xil.
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  });
  const address = {
    recipientName: 'Ali Valiyev',
    phone: '+998901234567',
    address: 'Toshkent, Amir Temur 1',
  };
  const checkout = (extra: Record<string, unknown> = {}) =>
    pipe.transform(
      { paymentMethod: CheckoutPaymentMethod.COD, address, ...extra },
      { type: 'body', metatype: CreateCheckoutDto },
    );

  it('berilmasa — butun savat (eski so‘rovlar o‘zgarmaydi)', async () => {
    const dto = (await checkout()) as CreateCheckoutDto;
    expect(dto.cartItemIds).toBeUndefined();
  });

  it('tanlangan qator id’larini qabul qiladi', async () => {
    await expect(
      checkout({ cartItemIds: ['10', '12'] }),
    ).resolves.toMatchObject({ cartItemIds: ['10', '12'] });
    await expect(
      pipe.transform(
        { address, cartItemIds: ['10'] },
        { type: 'body', metatype: DeliveryPreviewDto },
      ),
    ).resolves.toMatchObject({ cartItemIds: ['10'] });
  });

  it.each([
    ['bo‘sh ro‘yxat', []],
    ['takroriy id', ['10', '10']],
    ['son emas', ['abc']],
    ['nol', ['0']],
    ['raqam (satr emas)', [10]],
    ['massiv emas', '10'],
    [
      `${MAX_CHECKOUT_CART_ITEMS} tadan ko‘p`,
      Array.from({ length: MAX_CHECKOUT_CART_ITEMS + 1 }, (_, i) =>
        String(i + 1),
      ),
    ],
  ])('rad etadi: %s', async (_case, cartItemIds) => {
    await expect(checkout({ cartItemIds })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
