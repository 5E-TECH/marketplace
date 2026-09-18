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
    expect(query.mock.calls[0][0]).toContain('s.elchi_shipment_id IS NOT NULL');
    expect(query.mock.calls[0][1]).toEqual(['4', 'RECEIVED', 20, 0]);
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
