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

  it('TC1: payment.create CREATED holatdagi payment yozadi', async () => {
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
      status: PaymentStatus.CREATED,
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
