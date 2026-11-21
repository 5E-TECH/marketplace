import { of } from 'rxjs';
import { CheckoutPaymentMethod } from '@app/common';
import { ElchiWebhookService } from './elchi-webhook.service';

describe('ElchiWebhookService (C2.4)', () => {
  const event = (
    status:
      | 'on_the_road'
      | 'received'
      | 'returned'
      | 'sold'
      | 'cancelled'
      | 'settled'
      | 'paid'
      | 'partly_paid'
      | 'closed' = 'on_the_road',
  ) => ({
    eventId: `evt_${status}`,
    type: 'shipment.status_changed',
    shipmentId: '77012',
    externalOrderId: '55',
    status,
    occurredAt: new Date().toISOString(),
  });

  function setup(
    options: {
      duplicate?: boolean;
      paymentMethod?: CheckoutPaymentMethod;
      /** BE-21: posilkaning joriy holati (sukut — Elchi’da yaratilgan). */
      current?: string;
    } = {},
  ) {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const manager = {
      query: jest.fn(async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        if (sql.includes('SELECT event_id')) {
          return options.duplicate ? [{ event_id: 'evt' }] : [];
        }
        if (sql.includes('FROM checkout.sales_order_seller s')) {
          return [
            {
              id: '55',
              sales_order_id: '10',
              shop_id: '7',
              subtotal: '499000',
              status: options.current ?? 'SHIPMENT_CREATED',
              payment_id: '91',
              elchi_shipment_id: '77012',
              payment_method:
                options.paymentMethod ?? CheckoutPaymentMethod.COD,
            },
          ];
        }
        if (sql.includes('FROM checkout.sales_order_item')) {
          return [{ variantId: '88', quantity: 2 }];
        }
        return [];
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (run) => run(manager)),
    };
    const inventory = { send: jest.fn(() => of({ operation: 'INBOUND' })) };
    const payment = { send: jest.fn(() => of({ status: 'REFUNDED' })) };
    // BE-03: moliya hodisalari outbox ga yoziladi; `finance.emit` — yozilgan
    // hodisalarning qulay ko'rinishi (relay ularni xuddi shunday yuboradi).
    const finance = { emit: jest.fn() };
    const outbox = {
      record: jest.fn(
        async (input: { eventType: string; payload: unknown }) => {
          finance.emit(input.eventType, input.payload);
        },
      ),
    };
    // BE-21: lid buyurtmasi (`mp-order:`) alohida servisga
    const leadWebhook = {
      orderIdOf: jest.fn((e: { externalOrderId: string }) =>
        e.externalOrderId.startsWith('mp-order:') ? '5' : null,
      ),
      process: jest.fn(async () => ({ received: true, result: 'APPLIED' })),
    };
    return {
      service: new ElchiWebhookService(
        dataSource as never,
        inventory as never,
        payment as never,
        outbox as never,
        leadWebhook as never,
      ),
      leadWebhook,
      inventory,
      payment,
      finance,
      outbox,
      manager,
      queries,
    };
  }

  it('TC1: statusni seller orderga mirror qiladi', async () => {
    const { service, queries } = setup();
    await expect(service.process(event())).resolves.toEqual({
      received: true,
      result: 'APPLIED',
    });
    const update = queries.find((entry) =>
      entry.sql.includes('UPDATE checkout.sales_order_seller'),
    );
    expect(update?.params).toEqual(['ON_THE_ROAD', '55']);
  });

  it('C1.45 TC6: skaner received eventi buyurtmani RECEIVED qiladi', async () => {
    const { service, queries } = setup();
    await service.process(event('received'));
    const update = queries.find((entry) =>
      entry.sql.includes('UPDATE checkout.sales_order_seller'),
    );
    expect(update?.params).toEqual(['RECEIVED', '55']);
  });

  it('TC3: returned event inventory inbound oqimini chaqiradi', async () => {
    const { service, inventory } = setup();
    await service.process(event('returned'));
    expect(inventory.send).toHaveBeenCalledWith(
      { cmd: 'inventory.return-order-items' },
      expect.objectContaining({
        orderRef: '10',
        items: [{ variantId: '88', quantity: 2 }],
        idempotencyKey: 'elchi-return:evt_returned',
      }),
    );
  });

  it('TC4: bir event ikkinchi marta kelganda side effect qilmaydi', async () => {
    const { service, inventory, payment, finance, queries } = setup({
      duplicate: true,
    });
    await expect(service.process(event())).resolves.toEqual({
      received: true,
      duplicate: true,
    });
    expect(inventory.send).not.toHaveBeenCalled();
    expect(payment.send).not.toHaveBeenCalled();
    expect(finance.emit).not.toHaveBeenCalled();
    expect(
      queries.some((entry) =>
        entry.sql.includes('UPDATE checkout.sales_order_seller'),
      ),
    ).toBe(false);
  });

  it('C3.6 TC1-TC3: online returned payment, inventory va ledger refund qiladi', async () => {
    const { service, inventory, payment, finance } = setup({
      paymentMethod: CheckoutPaymentMethod.ONLINE,
    });
    await service.process(event('returned'));

    expect(inventory.send).toHaveBeenCalledWith(
      { cmd: 'inventory.return-order-items' },
      expect.objectContaining({ idempotencyKey: 'elchi-return:evt_returned' }),
    );
    expect(payment.send).toHaveBeenCalledWith(
      { cmd: 'payment.refund' },
      expect.objectContaining({
        paymentId: '91',
        salesOrderId: '10',
        sellerOrderId: '55',
        idempotencyKey: 'elchi-refund:evt_returned',
      }),
    );
    expect(finance.emit).toHaveBeenCalledWith(
      'finance.refund.requested',
      expect.objectContaining({ sellerOrderId: '55', shopId: '7' }),
    );
  });

  it('C3.6: online cancelled paymentni refund qiladi, inbound qilmaydi', async () => {
    const { service, inventory, payment, finance } = setup({
      paymentMethod: CheckoutPaymentMethod.ONLINE,
    });
    await service.process(event('cancelled'));

    expect(payment.send).toHaveBeenCalledWith(
      { cmd: 'payment.refund' },
      expect.objectContaining({ idempotencyKey: 'elchi-refund:evt_cancelled' }),
    );
    expect(inventory.send).not.toHaveBeenCalled();
    expect(finance.emit).not.toHaveBeenCalled();
  });

  it('delivered online order uchun payout event chiqaradi', async () => {
    const { service, finance } = setup({
      paymentMethod: CheckoutPaymentMethod.ONLINE,
    });
    await service.process(event('sold'));
    expect(finance.emit).toHaveBeenCalledWith(
      'finance.payout.requested',
      expect.objectContaining({
        eventId: 'evt_sold',
        shopId: '7',
        amount: 499000,
      }),
    );
  });

  it('BE-03 TC1: moliya hodisasi webhook tranzaksiyasi ichida outbox ga yoziladi', async () => {
    const { service, outbox, manager } = setup({
      paymentMethod: CheckoutPaymentMethod.ONLINE,
    });
    await service.process(event('sold'));
    expect(outbox.record).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregateType: 'sales_order_seller',
        aggregateId: '55',
        eventType: 'finance.payout.requested',
      }),
      manager,
    );
  });

  it('C4.3 TC1: COD settled finance reconciliation event chiqaradi', async () => {
    const { service, finance } = setup({
      paymentMethod: CheckoutPaymentMethod.COD,
    });
    await service.process({ ...event('settled'), codCollected: 499000 });
    expect(finance.emit).toHaveBeenCalledWith(
      'finance.cod.settled',
      expect.objectContaining({
        sellerOrderId: '55',
        expectedAmount: 499000,
        collectedAmount: 499000,
      }),
    );
  });

  describe('BE-21: faqat oldinga, pul holatlari, lid buyurtmasi', () => {
    const updated = (queries: Array<{ sql: string }>) =>
      queries.some((entry) =>
        entry.sql.includes('UPDATE checkout.sales_order_seller'),
      );
    const journaled = (queries: Array<{ sql: string; params: unknown[] }>) =>
      queries.find((entry) =>
        entry.sql.includes('INSERT INTO checkout.elchi_webhook_event'),
      )?.params;

    it('TC1: «Yetkazildi» dan keyin «Yo‘lda» — o‘zgarmaydi, jurnalda REJECTED', async () => {
      const { service, queries } = setup({ current: 'DELIVERED' });
      await expect(service.process(event('on_the_road'))).resolves.toEqual({
        received: true,
        result: 'REJECTED',
      });
      expect(updated(queries)).toBe(false);
      expect(journaled(queries)?.[6]).toBe('REJECTED');
    });

    it('takroriy «qaytarildi» (yangi event_id) — qoldiq ikkinchi marta qaytmaydi', async () => {
      const { service, inventory, queries } = setup({ current: 'RETURNED' });
      await expect(service.process(event('returned'))).resolves.toEqual({
        received: true,
        result: 'NOOP',
      });
      expect(inventory.send).not.toHaveBeenCalled();
      expect(updated(queries)).toBe(false);
    });

    it('T9-7: Elchi `paid` — eski COD hisob-kitobi (yig‘ilgan summa `collected_from_customer` dan)', async () => {
      const { service, finance } = setup({ current: 'DELIVERED' });
      await service.process({
        ...event('paid'),
        collectedFromCustomer: 499000,
      });
      expect(finance.emit).toHaveBeenCalledWith(
        'finance.cod.settled',
        expect.objectContaining({ collectedAmount: 499000 }),
      );
    });

    it('`partly_paid` va `closed` — holatga ta’sir yo‘q, jurnalda IGNORED', async () => {
      for (const status of ['partly_paid', 'closed'] as const) {
        const { service, queries, finance } = setup({ current: 'DELIVERED' });
        await expect(service.process(event(status))).resolves.toEqual({
          received: true,
          result: 'IGNORED',
        });
        expect(updated(queries)).toBe(false);
        expect(finance.emit).not.toHaveBeenCalled();
      }
    });

    it('`mp-order:` — lid buyurtmasi servisiga, eski jadvalga tegilmaydi', async () => {
      const { service, leadWebhook, manager } = setup();
      await service.process({
        ...event('sold'),
        externalOrderId: 'mp-order:5',
      });
      expect(leadWebhook.process).toHaveBeenCalled();
      expect(manager.query).not.toHaveBeenCalled();
    });
  });
});
