import { PaymentProvider, PaymentStatus } from '@app/common';
import { of } from 'rxjs';
import { PaymentEventsService } from './payment-events.service';

describe('PaymentEventsService (C3.4)', () => {
  it('PAID payment uchun payment.paid eventini checkout queuega yuboradi', async () => {
    const checkout = { emit: jest.fn(() => of(undefined)) };
    const service = new PaymentEventsService(checkout as never);
    const paidAt = new Date('2026-08-29T08:00:00.000Z');

    await service.paid({
      id: '90',
      salesOrderId: '42',
      provider: PaymentProvider.PAYME,
      amount: 500,
      status: PaymentStatus.PAID,
      paidAt,
    } as never);

    expect(checkout.emit).toHaveBeenCalledWith('payment.paid', {
      paymentId: '90',
      salesOrderId: '42',
      provider: PaymentProvider.PAYME,
      amount: 500,
      paidAt: paidAt.toISOString(),
    });
  });
});
