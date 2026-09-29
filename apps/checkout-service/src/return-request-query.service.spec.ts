import { NotFoundException } from '@nestjs/common';
import { ReturnRequestStatus } from '@app/common';
import { ReturnRequestQueryService } from './return-request-query.service';

describe('ReturnRequestQueryService (C4.2)', () => {
  const row = {
    id: '3',
    orderId: '10',
    sellerOrderId: '51',
    shopId: '7',
    shopName: 'Nova',
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

  function setup(rows: unknown[] = [row]) {
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
            imageUrl: null,
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
      service: new ReturnRequestQueryService(dataSource as never),
      calls,
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
});
