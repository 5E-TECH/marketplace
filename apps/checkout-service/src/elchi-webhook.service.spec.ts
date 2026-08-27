import { of } from 'rxjs';
import { CheckoutPaymentMethod } from '@app/common';
import { ElchiWebhookService } from './elchi-webhook.service';

describe('ElchiWebhookService (C2.4)', () => {
  const event = (
    status: 'on_the_road' | 'returned' | 'sold' = 'on_the_road',
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
    const finance = { emit: jest.fn(() => of(undefined)) };
    return {
      service: new ElchiWebhookService(
        dataSource as never,
        inventory as never,
        finance as never,
      ),
      inventory,
      finance,
      queries,
    };
  }

  it('TC1: statusni seller orderga mirror qiladi', async () => {
    const { service, queries } = setup();
    await expect(service.process(event())).resolves.toEqual({ received: true });
    const update = queries.find((entry) =>
      entry.sql.includes('UPDATE checkout.sales_order_seller'),
    );
    expect(update?.params).toEqual(['ON_THE_ROAD', '55']);
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
    const { service, inventory, finance, queries } = setup({ duplicate: true });
    await expect(service.process(event())).resolves.toEqual({
      received: true,
      duplicate: true,
    });
    expect(inventory.send).not.toHaveBeenCalled();
    expect(finance.emit).not.toHaveBeenCalled();
    expect(
      queries.some((entry) =>
        entry.sql.includes('UPDATE checkout.sales_order_seller'),
      ),
    ).toBe(false);
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
});
