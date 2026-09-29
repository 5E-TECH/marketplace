import { BadRequestException } from '@nestjs/common';
import { PaymentProvider, PaymentStatus } from '@app/common';
import { Payment } from './entities/payment.entity';
import { PaymentRefundService } from './payment-refund.service';

describe('PaymentRefundService (C3.6)', () => {
  function setup(status: PaymentStatus = PaymentStatus.PAID) {
    const payment = {
      id: '91',
      salesOrderId: '10',
      provider: PaymentProvider.PAYME,
      amount: 499000,
      status,
      externalTxnId: 'payme-77',
      createdAt: new Date(),
    };
    const payments = {
      findOne: jest.fn().mockResolvedValue(payment),
      save: jest.fn(async (value) => value),
    };
    const transactions = {
      findOne: jest.fn(),
      save: jest.fn(),
    };
    const payme = {
      cancelPaidPayment: jest.fn().mockResolvedValue({
        providerTxnId: 'payme-77',
        state: -2,
        action: 'CancelTransaction',
      }),
    };
    return {
      service: new PaymentRefundService(
        payments as never,
        transactions as never,
        payme as never,
      ),
      payment,
      payments,
      payme,
    };
  }

  const dto = {
    paymentId: '91',
    salesOrderId: '10',
    sellerOrderId: '55',
    reason: 'Elchi returned',
    idempotencyKey: 'elchi-refund:evt_returned',
  };

  it('TC1: online returned Payme CancelTransaction va REFUNDED qiladi', async () => {
    const { service, payment, payments, payme } = setup();
    await expect(service.refund(dto)).resolves.toMatchObject({
      paymentId: '91',
      status: PaymentStatus.REFUNDED,
      idempotent: false,
    });
    expect(payme.cancelPaidPayment).toHaveBeenCalledWith(payment);
    expect(payments.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: PaymentStatus.REFUNDED }),
    );
  });

  it('takror refund providerga ikkinchi marta yuborilmaydi', async () => {
    const { service, payments, payme } = setup(PaymentStatus.REFUNDED);
    await expect(service.refund(dto)).resolves.toMatchObject({
      status: PaymentStatus.REFUNDED,
      idempotent: true,
    });
    expect(payme.cancelPaidPayment).not.toHaveBeenCalled();
    expect(payments.save).not.toHaveBeenCalled();
  });

  it('to‘lanmagan payment refund qilinmaydi', async () => {
    const { service } = setup(PaymentStatus.CREATED);
    await expect(service.refund(dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  describe('C4.2 qisman refund (qaytarish so‘rovi)', () => {
    function partial(
      options: {
        status?: PaymentStatus;
        refunded?: number;
        existing?: { paymentId: string; amount: number };
      } = {},
    ) {
      const payment = {
        id: '91',
        salesOrderId: '10',
        provider: PaymentProvider.PAYME,
        amount: 500000,
        status: options.status ?? PaymentStatus.PAID,
        externalTxnId: 'payme-77',
        createdAt: new Date(),
      };
      const saved: unknown[] = [];
      const paymentRepo = {
        findOne: jest.fn().mockResolvedValue(payment),
        save: jest.fn(async (value) => value),
      };
      const refundRepo = {
        findOne: jest.fn().mockResolvedValue(options.existing ?? null),
        create: jest.fn((value) => value),
        save: jest.fn(async (value) => {
          saved.push(value);
          return value;
        }),
      };
      const manager = {
        query: jest.fn(async (sql: string) =>
          sql.includes('SUM(amount)') ? [{ total: options.refunded ?? 0 }] : [],
        ),
        getRepository: jest.fn((entity) =>
          entity === Payment ? paymentRepo : refundRepo,
        ),
      };
      const payments = {
        manager: { transaction: jest.fn(async (run) => run(manager)) },
      };
      const payme = { cancelPaidPayment: jest.fn() };
      return {
        service: new PaymentRefundService(
          payments as never,
          {} as never,
          payme as never,
        ),
        payment,
        paymentRepo,
        saved,
        payme,
      };
    }

    const partialDto = {
      ...dto,
      idempotencyKey: 'return-refund:3',
      amount: 200000,
    };

    it('qoldiqdan kam summa yoziladi, to‘lov PAID qoladi', async () => {
      const { service, saved, payme, paymentRepo } = partial();
      await expect(service.refund(partialDto)).resolves.toMatchObject({
        status: PaymentStatus.PAID,
        amount: 200000,
        refundedTotal: 200000,
        idempotent: false,
      });
      expect(saved).toEqual([
        expect.objectContaining({ paymentId: '91', amount: 200000 }),
      ]);
      expect(payme.cancelPaidPayment).not.toHaveBeenCalled();
      expect(paymentRepo.save).not.toHaveBeenCalled();
    });

    it('qoldiq nolga tushsa provayder bekor qilinadi va REFUNDED bo‘ladi', async () => {
      const { service, payme, paymentRepo, payment } = partial({
        refunded: 300000,
      });
      await expect(service.refund(partialDto)).resolves.toMatchObject({
        status: PaymentStatus.REFUNDED,
        refundedTotal: 500000,
      });
      expect(payme.cancelPaidPayment).toHaveBeenCalledWith(payment);
      expect(paymentRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: PaymentStatus.REFUNDED }),
      );
    });

    it('jami to‘lov summasidan oshsa rad etiladi', async () => {
      const { service, saved } = partial({ refunded: 400000 });
      await expect(service.refund(partialDto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(saved).toHaveLength(0);
    });

    it('takror kalit ikkinchi marta yozmaydi va avvalgi summani qaytaradi', async () => {
      const { service, saved } = partial({
        refunded: 150000,
        existing: { paymentId: '91', amount: 150000 },
      });
      await expect(service.refund(partialDto)).resolves.toMatchObject({
        idempotent: true,
        amount: 150000,
      });
      expect(saved).toHaveLength(0);
    });

    it('to‘liq qaytarilgan to‘lovga qisman refund yo‘q', async () => {
      const { service } = partial({ status: PaymentStatus.REFUNDED });
      await expect(service.refund(partialDto)).rejects.toThrow('allaqachon');
    });
  });
});
