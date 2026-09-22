import { Payment } from './entities/payment.entity';
import { BadRequestException } from '@nestjs/common';
import { PaymentProvider, PaymentStatus } from '@app/common';
import { PaymentService } from './payment.service';

describe('PaymentService (C3.1)', () => {
  const encryptionKey = 'test-payment-aes-secret';

  function setup() {
    const paymentRows: Array<Record<string, unknown>> = [];
    const configRows: Array<Record<string, unknown>> = [];
    const payments = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        const saved = {
          id: String(paymentRows.length + 1),
          createdAt: new Date('2026-09-16T10:00:00Z'),
          ...value,
        };
        paymentRows.push(saved);
        return saved;
      }),
    };
    const providerConfigs = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        const saved = {
          id: String(configRows.length + 1),
          createdAt: new Date(),
          updatedAt: new Date(),
          merchantId: null,
          secretEncrypted: null,
          baseUrl: null,
          isActive: true,
          ...value,
        };
        configRows.push(saved);
        return saved;
      }),
    };
    const config = {
      getOrThrow: jest.fn(() => encryptionKey),
    };
    const manager = {
      query: jest.fn(),
      getRepository: (entity: unknown) =>
        entity === Payment ? payments : providerConfigs,
      transaction: async (work: (m: unknown) => unknown) => work(manager),
    };
    Object.assign(payments, { manager });
    return {
      service: new PaymentService(
        payments as never,
        providerConfigs as never,
        config as never,
      ),
      payments,
      providerConfigs,
      paymentRows,
      configRows,
    };
  }

  it('TC1: payment.create PENDING holatdagi payment yozadi', async () => {
    const { service, paymentRows } = setup();
    await expect(
      service.create({
        salesOrderId: '42',
        provider: PaymentProvider.PAYME,
        amount: 125000,
      }),
    ).resolves.toMatchObject({
      id: '1',
      salesOrderId: '42',
      provider: PaymentProvider.PAYME,
      amount: 125000,
      status: PaymentStatus.PENDING,
    });
    expect(paymentRows).toHaveLength(1);
  });

  it('payment.create takror chaqirilsa mavjud paymentni qaytaradi', async () => {
    const { service, payments } = setup();
    payments.findOne.mockResolvedValueOnce({
      id: '9',
      salesOrderId: '42',
      provider: PaymentProvider.CLICK,
      amount: 50000,
      status: PaymentStatus.CREATED,
      createdAt: new Date(),
    });
    await expect(
      service.create({
        salesOrderId: '42',
        provider: PaymentProvider.CLICK,
        amount: 50000,
      }),
    ).resolves.toMatchObject({ id: '9' });
    expect(payments.save).not.toHaveBeenCalled();
  });

  it('mavjud payment summasi boshqacha bo‘lsa rad etadi', async () => {
    const { service, payments } = setup();
    payments.findOne.mockResolvedValueOnce({
      id: '9',
      salesOrderId: '42',
      provider: PaymentProvider.PAYME,
      amount: 50000,
      status: PaymentStatus.CREATED,
      createdAt: new Date(),
    });
    await expect(
      service.create({
        salesOrderId: '42',
        provider: PaymentProvider.PAYME,
        amount: 60000,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('Payme uchun base64 checkout link qaytaradi (tiyin + returnUrl)', async () => {
    const { service, providerConfigs } = setup();
    providerConfigs.findOne.mockResolvedValueOnce({
      id: '1',
      provider: PaymentProvider.PAYME,
      merchantId: 'kassa-1',
      serviceId: null,
      baseUrl: 'https://test.paycom.uz',
    });
    const result = await service.create({
      salesOrderId: '42',
      provider: PaymentProvider.PAYME,
      amount: 125000,
      returnUrl: 'https://shop.example.com/orders/42',
    });
    const [base, encoded] = String(result.redirectUrl).split(
      'https://test.paycom.uz/',
    );
    expect(base).toBe('');
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe(
      'm=kassa-1;ac.order_id=1;a=12500000;c=https://shop.example.com/orders/42',
    );
  });

  it('Click uchun service_id/merchant_id bilan pay link qaytaradi', async () => {
    const { service, providerConfigs } = setup();
    providerConfigs.findOne.mockResolvedValueOnce({
      id: '1',
      provider: PaymentProvider.CLICK,
      merchantId: 'merchant-1',
      serviceId: '12345',
      baseUrl: null,
    });
    const result = await service.create({
      salesOrderId: '42',
      provider: PaymentProvider.CLICK,
      amount: 125000,
    });
    const url = new URL(String(result.redirectUrl));
    expect(url.origin + url.pathname).toBe('https://my.click.uz/services/pay');
    expect(url.searchParams.get('service_id')).toBe('12345');
    expect(url.searchParams.get('merchant_id')).toBe('merchant-1');
    expect(url.searchParams.get('amount')).toBe('125000.00');
    expect(url.searchParams.get('transaction_param')).toBe('1');
    expect(url.searchParams.get('return_url')).toBeNull();
  });

  it('provider sozlanmagan bo‘lsa redirectUrl null bo‘ladi, xato emas', async () => {
    const { service } = setup();
    await expect(
      service.create({
        salesOrderId: '42',
        provider: PaymentProvider.PAYME,
        amount: 125000,
      }),
    ).resolves.toMatchObject({ redirectUrl: null });
  });

  it('to‘langan payment uchun checkout link berilmaydi', async () => {
    const { service, payments, providerConfigs } = setup();
    payments.findOne.mockResolvedValueOnce({
      id: '9',
      salesOrderId: '42',
      provider: PaymentProvider.PAYME,
      amount: 50000,
      status: PaymentStatus.PAID,
      createdAt: new Date(),
    });
    await expect(
      service.create({
        salesOrderId: '42',
        provider: PaymentProvider.PAYME,
        amount: 50000,
      }),
    ).resolves.toMatchObject({ redirectUrl: null });
    expect(providerConfigs.findOne).not.toHaveBeenCalled();
  });

  it('bekor qilishda faqat yakunlanmagan to‘lovlar yopiladi', async () => {
    const { service, payments } = setup();
    const open = {
      id: '1',
      salesOrderId: '42',
      status: PaymentStatus.PENDING,
    };
    const alreadyCancelled = {
      id: '2',
      salesOrderId: '42',
      status: PaymentStatus.CANCELLED,
    };
    payments.find.mockResolvedValueOnce([open, alreadyCancelled]);
    await expect(
      service.cancelOpen({ salesOrderId: '42' }),
    ).resolves.toMatchObject({ salesOrderId: '42', cancelled: 1 });
    expect(open.status).toBe(PaymentStatus.CANCELLED);
    expect(payments.save).toHaveBeenCalledWith([open]);
  });

  it('to‘langan buyurtmani bekor qilishga yo‘l qo‘ymaydi', async () => {
    const { service, payments } = setup();
    payments.find.mockResolvedValueOnce([
      { id: '1', salesOrderId: '42', status: PaymentStatus.PAID },
    ]);
    await expect(service.cancelOpen({ salesOrderId: '42' })).rejects.toThrow(
      'refund',
    );
    expect(payments.save).not.toHaveBeenCalled();
  });

  it('yopiladigan to‘lov bo‘lmasa DBga yozmaydi', async () => {
    const { service, payments } = setup();
    await expect(
      service.cancelOpen({ salesOrderId: '42' }),
    ).resolves.toMatchObject({ cancelled: 0 });
    expect(payments.save).not.toHaveBeenCalled();
  });

  it('TC2: provider secretni DBga AES shifrlab yozadi va javobda yashiradi', async () => {
    const { service, configRows } = setup();
    const result = await service.upsertProviderConfig(PaymentProvider.PAYME, {
      merchantId: 'merchant-1',
      secret: 'plain-provider-secret',
      baseUrl: 'https://checkout.payme.uz',
    });
    expect(configRows[0].secretEncrypted).not.toBe('plain-provider-secret');
    expect(String(configRows[0].secretEncrypted)).toMatch(
      /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/,
    );
    expect(result).not.toHaveProperty('secretEncrypted');
  });

  it('TC3: ichki IP provider URL sifatida berilsa SSRF guard bloklaydi', async () => {
    const { service, providerConfigs } = setup();
    await expect(
      service.upsertProviderConfig(PaymentProvider.CLICK, {
        baseUrl: 'http://127.0.0.1:8080/callback',
      }),
    ).rejects.toThrow('SSRF');
    expect(providerConfigs.save).not.toHaveBeenCalled();
  });
});
