import { NotFoundException } from '@nestjs/common';
import { NEVER, of, throwError } from 'rxjs';
import { CATALOG_DISPLAY_LOOKUP, ReturnRequestStatus } from '@app/common';
import { CATALOG_DISPLAY_TIMEOUT_MS } from './catalog-display.util';
import { ReturnRequestQueryService } from './return-request-query.service';

describe('ReturnRequestQueryService (C4.2)', () => {
  const row = {
    id: '3',
    orderId: '10',
    sellerOrderId: '51',
    shopId: '7',
    buyerName: 'Ali',
    status: ReturnRequestStatus.REFUNDED,
    reason: 'CHANGED_MIND',
    comment: null,
    paymentMethod: 'online',
    requestedAmount: '200000',
    refundedAmount: '150000',
    restocked: true,
    decisionComment: null,
    decidedAt: null,
    refundedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function setup(
    rows: unknown[] = [row],
    catalog = {
      send: jest.fn(() =>
        of({
          shops: [{ id: '7', name: 'Nova' }],
          products: [{ id: '7', imageUrl: 'https://cdn/nova-12.webp' }],
          variants: [],
        }),
      ),
    },
  ) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const query = jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('COUNT(*)')) return [{ total: rows.length }];
      if (sql.includes('FROM checkout.return_request_item ri')) {
        return [
          {
            id: '5',
            returnRequestId: '3',
            orderItemId: '31',
            productId: '7',
            variantId: '12',
            productName: 'Nova 12',
            quantity: 1,
            unitPrice: '200000',
            lineTotal: '200000',
          },
        ];
      }
      if (sql.includes('FROM checkout.return_request_history')) {
        return [{ toStatus: 'SUBMITTED', actorRole: 'BUYER' }];
      }
      return rows;
    });
    const dataSource = { query, manager: { query } };
    return {
      service: new ReturnRequestQueryService(
        dataSource as never,
        catalog as never,
      ),
      calls,
      catalog,
    };
  }

  it('sotuvchi ro‘yxati o‘z do‘koni va holat bilan filtrlanadi, summalar son bo‘ladi', async () => {
    const { service, calls } = setup();
    const page = await service.list({
      shopId: '7',
      status: ReturnRequestStatus.SUBMITTED,
      page: 2,
      limit: 10,
    });

    const list = calls.find((call) => call.sql.includes('LIMIT'))!;
    expect(list.sql).toContain('r.shop_id = $1');
    expect(list.sql).toContain('r.status = $2');
    expect(list.params).toEqual(['7', 'SUBMITTED', 10, 10]);
    expect(page).toMatchObject({ total: 1, page: 2, limit: 10 });
    expect(page.items[0]).toMatchObject({
      requestedAmount: 200000,
      refundedAmount: 150000,
      restocked: true,
      items: [{ orderItemId: '31', quantity: 1, lineTotal: 200000 }],
    });
  });

  it('xaridor faqat o‘z so‘rovini tarix bilan ko‘radi, begonasi 404', async () => {
    const { service, calls } = setup();
    await expect(service.get('3', { customerId: '5' })).resolves.toMatchObject({
      id: '3',
      history: [{ toStatus: 'SUBMITTED' }],
    });
    expect(calls[0].sql).toContain('r.customer_id = $2');

    await expect(
      setup([]).service.get('3', { customerId: '9' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(setup().service.get('1; DROP')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('BE-29: do‘kon nomi va rasm katalog RPC dan — checkout SQL i `catalog.*` ga murojaat qilmaydi', async () => {
    const { service, calls, catalog } = setup();
    const page = await service.list({});

    expect(calls.every((call) => !/\bcatalog\./.test(call.sql))).toBe(true);
    expect(catalog.send).toHaveBeenCalledTimes(1);
    expect(catalog.send).toHaveBeenCalledWith(
      { cmd: CATALOG_DISPLAY_LOOKUP },
      { shopIds: ['7'], productIds: ['7'] },
    );
    expect(page.items[0]).toMatchObject({
      shopName: 'Nova',
      items: [{ productId: '7', imageUrl: 'https://cdn/nova-12.webp' }],
    });
  });

  it('BE-29: katalog javob bermasa ro‘yxat ochiladi — nom va rasm null', async () => {
    const { service } = setup([row], {
      send: jest.fn(() => throwError(() => new Error('catalog o‘chiq'))),
    });
    const details = await service.get('3');

    expect(details).toMatchObject({
      shopName: null,
      items: [{ productId: '7', imageUrl: null }],
    });
  });

  it('BE-29: katalog javob bermasa 1,5 s dan keyin nomsiz javob — gateway 10 s kutib qolmaydi', async () => {
    jest.useFakeTimers();
    try {
      const { service } = setup([row], { send: jest.fn(() => NEVER) });
      const pending = service.list({});
      await jest.advanceTimersByTimeAsync(CATALOG_DISPLAY_TIMEOUT_MS);
      await expect(pending).resolves.toMatchObject({
        items: [{ shopName: null, items: [{ imageUrl: null }] }],
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
