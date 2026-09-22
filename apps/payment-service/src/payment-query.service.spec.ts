import { PaymentProvider, PaymentStatus } from '@app/common';
import { PaymentQueryService } from './payment-query.service';

describe('PaymentQueryService', () => {
  function setup(
    rows: Array<Record<string, unknown>>,
    transaction: Record<string, unknown> | null = null,
  ) {
    const payments = { find: jest.fn().mockResolvedValue(rows) };
    const transactions = { findOne: jest.fn().mockResolvedValue(transaction) };
    return {
      service: new PaymentQueryService(
        payments as never,
        transactions as never,
      ),
      payments,
      transactions,
    };
  }

  it('noto‘g‘ri ID lar filtrlanadi, bo‘sh ro‘yxatda DB ga bormaydi', async () => {
    const { service, payments } = setup([]);
    await expect(service.summaryByOrders(['0', 'abc', ''])).resolves.toEqual(
      {},
    );
    expect(payments.find).not.toHaveBeenCalled();
  });

  it('buyurtma bo‘yicha eng yakuniy to‘lovni tanlaydi', async () => {
    // Xaridor Click'da urinib ko‘rgan (yangiroq), lekin Payme'da to‘lagan.
    const { service } = setup([
      {
        id: '8',
        salesOrderId: '42',
        provider: PaymentProvider.CLICK,
        amount: '125000.00',
        status: PaymentStatus.CREATED,
        paidAt: null,
      },
      {
        id: '7',
        salesOrderId: '42',
        provider: PaymentProvider.PAYME,
        amount: '125000.00',
        status: PaymentStatus.PAID,
        paidAt: new Date('2026-09-16T10:00:00Z'),
      },
    ]);
    await expect(service.summaryByOrders(['42'])).resolves.toMatchObject({
      '42': {
        paymentId: '7',
        provider: PaymentProvider.PAYME,
        status: PaymentStatus.PAID,
        amount: 125000,
        failureReason: null,
      },
    });
  });

  it('eski CREATED qator tashqarida PENDING bo‘lib ko‘rinadi', async () => {
    const { service } = setup([
      {
        id: '7',
        salesOrderId: '42',
        provider: PaymentProvider.PAYME,
        amount: '125000.00',
        status: PaymentStatus.CREATED,
        paidAt: null,
        updatedAt: new Date('2026-09-16T10:05:00Z'),
      },
    ]);
    await expect(service.summaryByOrders(['42'])).resolves.toMatchObject({
      '42': {
        status: PaymentStatus.PENDING,
        updatedAt: new Date('2026-09-16T10:05:00Z'),
      },
    });
  });

  it('refund qilingan to‘lov PAID dan ustun turadi', async () => {
    const { service } = setup([
      {
        id: '9',
        salesOrderId: '42',
        provider: PaymentProvider.CLICK,
        amount: '125000.00',
        status: PaymentStatus.PAID,
        paidAt: new Date('2026-09-16T10:00:00Z'),
      },
      {
        id: '7',
        salesOrderId: '42',
        provider: PaymentProvider.PAYME,
        amount: '125000.00',
        status: PaymentStatus.REFUNDED,
        paidAt: new Date('2026-09-15T10:00:00Z'),
      },
    ]);
    await expect(service.summaryByOrders(['42'])).resolves.toMatchObject({
      '42': { paymentId: '7', status: PaymentStatus.REFUNDED },
    });
  });

  it('Payme bekor qilish kodini o‘qiladigan sababga aylantiradi', async () => {
    const { service } = setup(
      [
        {
          id: '7',
          salesOrderId: '42',
          provider: PaymentProvider.PAYME,
          amount: '125000.00',
          status: PaymentStatus.CANCELLED,
          paidAt: null,
        },
      ],
      { id: '3', reason: 4, raw: {} },
    );
    await expect(service.summaryByOrders(['42'])).resolves.toMatchObject({
      '42': {
        failureReason: 'Tranzaksiya vaqt tugashi sababli bekor qilindi',
      },
    });
  });

  it('Click xatosi uchun error_note qaytadi', async () => {
    const { service } = setup(
      [
        {
          id: '7',
          salesOrderId: '42',
          provider: PaymentProvider.CLICK,
          amount: '125000.00',
          status: PaymentStatus.FAILED,
          paidAt: null,
        },
      ],
      { id: '3', reason: null, raw: { error_note: 'Insufficient funds' } },
    );
    await expect(service.summaryByOrders(['42'])).resolves.toMatchObject({
      '42': { failureReason: 'Insufficient funds' },
    });
  });

  it('tranzaksiya yo‘q bekor qilingan to‘lovga umumiy sabab beradi', async () => {
    const { service } = setup([
      {
        id: '7',
        salesOrderId: '42',
        provider: PaymentProvider.CLICK,
        amount: '125000.00',
        status: PaymentStatus.CANCELLED,
        paidAt: null,
      },
    ]);
    await expect(service.summaryByOrders(['42'])).resolves.toMatchObject({
      '42': { failureReason: 'To‘lov yakunlanmadi' },
    });
  });
});
