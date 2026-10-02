import { SalesOrderSellerStatus } from '@app/common';
import { AdminIntegrationQueryService } from './admin-integration-query.service';

describe('AdminIntegrationQueryService (C6.7)', () => {
  it('TC3: Elchi shipmentlarni filtr va pagination bilan qaytaradi', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id: '9', shipmentId: '1251131' }])
      .mockResolvedValueOnce([{ total: 1 }]);
    const service = new AdminIntegrationQueryService({ query } as never);
    await expect(
      service.shipments({
        shopId: '4',
        status: SalesOrderSellerStatus.RECEIVED,
        page: 1,
        limit: 20,
      }),
    ).resolves.toMatchObject({ total: 1, items: [{ id: '9' }] });
    // Sukut bo'yicha posilkasiz buyurtmalar ham chiqadi (avval qattiq filtr edi).
    expect(query.mock.calls[0][0]).not.toContain('elchi_shipment_id IS');
    expect(query.mock.calls[0][0]).toContain('o.status AS "orderStatus"');
    expect(query.mock.calls[0][1]).toEqual(['4', 'RECEIVED', 20, 0]);
  });

  it('shipmentState=created faqat Elchi posilkasi borlarini beradi', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 0 }]);
    const service = new AdminIntegrationQueryService({ query } as never);

    await service.shipments({ shipmentState: 'created', page: 1, limit: 20 });

    expect(query.mock.calls[0][0]).toContain(
      'WHERE TRUE AND s.elchi_shipment_id IS NOT NULL',
    );
    expect(query.mock.calls[1][0]).toContain(
      'WHERE TRUE AND s.elchi_shipment_id IS NOT NULL',
    );
  });

  /**
   * Regressiya (haqiqiy Postgres'da topildi): `all` shartsiz, filtr ham
   * berilmasa SQL `WHERE ORDER BY` bo'lib yiqilardi — admin sahifasining
   * birinchi so'rovi 500 berardi.
   */
  it('filtrsiz so‘rovda WHERE bo‘sh qolmaydi', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 0 }]);
    const service = new AdminIntegrationQueryService({ query } as never);

    await service.shipments({ page: 1, limit: 20 });

    for (const [sql] of query.mock.calls) {
      expect(sql).toContain('WHERE TRUE');
      expect(sql).not.toMatch(/WHERE\s+(ORDER|LIMIT|$)/);
    }
    expect(query.mock.calls[0][1]).toEqual([20, 0]);
  });

  /**
   * Prod holati (reviewer, 09-21): CONFIRMED | shipment yo'q | 1 ta — xaridor
   * "buyurtmam qani?" desa admin aynan shuni ko'ra olmasdi.
   */
  it('shipmentState=missing Elchi’ga topshirilmay qolganlarni beradi, count ham xuddi shunday', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        { id: '12', shipmentId: null, status: 'CONFIRMED' },
      ])
      .mockResolvedValueOnce([{ total: 1 }]);
    const service = new AdminIntegrationQueryService({ query } as never);

    await expect(
      service.shipments({ shipmentState: 'missing', page: 1, limit: 20 }),
    ).resolves.toMatchObject({ total: 1, items: [{ id: '12' }] });

    for (const [sql] of query.mock.calls) {
      expect(sql).toContain('s.elchi_shipment_id IS NULL');
      // yakunlangan sub-buyurtma va tasdiqlanmagan/to'lanmagan buyurtma kirmaydi
      expect(sql).toContain(
        "s.status NOT IN ('CANCELLED','RETURNED','DELIVERED')",
      );
      expect(sql).toContain(
        "o.status NOT IN ('DRAFT','PENDING_PAYMENT','CANCELLED','REFUNDED')",
      );
      // count so'rovi ham sales_order ni JOIN qiladi (o.status shart uchun)
      expect(sql).toContain('JOIN checkout.sales_order o');
    }
  });

  it('TC4: webhook tarixini payload bilan qaytaradi', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ eventId: 'evt_1', payload: { ok: true } }])
      .mockResolvedValueOnce([{ total: 1 }]);
    const service = new AdminIntegrationQueryService({ query } as never);
    await expect(
      service.webhooks({ eventId: 'evt_1', page: 1, limit: 10 }),
    ).resolves.toMatchObject({
      total: 1,
      items: [{ eventId: 'evt_1', payload: { ok: true } }],
    });
    expect(query.mock.calls[0][1]).toEqual(['evt_1', 10, 0]);
  });
});
