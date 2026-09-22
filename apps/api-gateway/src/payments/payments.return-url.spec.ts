import { BadRequestException } from '@nestjs/common';
import { of } from 'rxjs';
import { CreatePaymentDto, PaymentProvider } from '@app/common';
import { PaymentsController } from './payments.controller';

describe('PaymentsController returnUrl', () => {
  function setup(corsOrigins: string) {
    const payment = { send: jest.fn(() => of({ id: '1' })) };
    const checkout = { send: jest.fn(() => of({ amount: 125000 })) };
    const config = { get: jest.fn(() => corsOrigins) };
    return {
      controller: new PaymentsController(
        payment as never,
        checkout as never,
        config as never,
      ),
      payment,
    };
  }

  const dto = (returnUrl?: string): CreatePaymentDto => ({
    salesOrderId: '42',
    provider: PaymentProvider.PAYME,
    amount: 125000,
    returnUrl,
  });
  const request = { user: { sub: '9' } } as never;

  it('ruxsat etilgan origin payment-service ga uzatiladi', async () => {
    const { controller, payment } = setup(
      'https://shop.example.com,https://admin.example.com',
    );
    await controller.create(dto('https://shop.example.com/orders/42'), request);
    expect(payment.send).toHaveBeenCalledWith(
      { cmd: 'payment.create' },
      expect.objectContaining({
        returnUrl: 'https://shop.example.com/orders/42',
      }),
    );
  });

  it('begona domenga ochiq redirectga yo‘l qo‘ymaydi', async () => {
    const { controller, payment } = setup('https://shop.example.com');
    await expect(
      controller.create(dto('https://evil.example.net/steal'), request),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(payment.send).not.toHaveBeenCalled();
  });

  it('CORS_ORIGINS bo‘sh bo‘lsa (lokal) tekshirilmaydi', async () => {
    const { controller, payment } = setup('');
    await controller.create(dto('http://localhost:5173/orders/42'), request);
    expect(payment.send).toHaveBeenCalledWith(
      { cmd: 'payment.create' },
      expect.objectContaining({ returnUrl: 'http://localhost:5173/orders/42' }),
    );
  });

  it('returnUrl berilmasa undefined ketadi', async () => {
    const { controller, payment } = setup('https://shop.example.com');
    await controller.create(dto(), request);
    expect(payment.send).toHaveBeenCalledWith(
      { cmd: 'payment.create' },
      expect.objectContaining({ returnUrl: undefined }),
    );
  });
});
