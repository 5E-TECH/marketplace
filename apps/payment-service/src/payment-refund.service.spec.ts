import { BadRequestException } from '@nestjs/common';
import { PaymentProvider, PaymentStatus } from '@app/common';
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
});
