import { of } from 'rxjs';
import { ElchiIntegrationService } from './elchi-integration.service';

type AnyMock = Record<string, jest.Mock>;

function makeService(
  overrides: {
    provisionRepo?: AnyMock;
    geoRepo?: AnyMock;
    catalogSend?: jest.Mock;
    elchi?: AnyMock;
  } = {},
) {
  const provisionRepo: AnyMock = {
    findOne: jest.fn(() => Promise.resolve(null)),
    create: jest.fn((x: unknown) => x),
    save: jest.fn((x: unknown) => Promise.resolve(x)),
    find: jest.fn(() => Promise.resolve([])),
    ...(overrides.provisionRepo ?? {}),
  };
  const geoRepo: AnyMock = {
    findOne: jest.fn(() => Promise.resolve(null)),
    create: jest.fn((x: unknown) => x),
    save: jest.fn((x: unknown) => Promise.resolve(x)),
    ...(overrides.geoRepo ?? {}),
  };
  const catalogSend =
    overrides.catalogSend ?? jest.fn(() => of({ statusCode: 200 }));
  const elchi: AnyMock = {
    provisionMarket: jest.fn(() => Promise.resolve({ elchi_market_id: '500' })),
    getRegions: jest.fn(() => Promise.resolve([])),
    getDistricts: jest.fn(() => Promise.resolve([])),
    ...(overrides.elchi ?? {}),
  };
  const service = new ElchiIntegrationService(
    provisionRepo as never,
    geoRepo as never,
    { send: catalogSend } as never,
    elchi as never,
  );
  return { service, provisionRepo, geoRepo, catalogSend, elchi };
}

describe('ElchiIntegrationService (C1.6)', () => {
  it('TC1: shop.approved -> Elchi market ochiladi va shop.elchi_market_id yoziladi', async () => {
    const { service, catalogSend, elchi, provisionRepo } = makeService();

    await service.onShopApproved({
      shopId: '9',
      shopName: 'Zamon Store',
      phone: '+998901234567',
    });

    expect(elchi.provisionMarket).toHaveBeenCalledWith({
      external_seller_id: '9',
      name: 'Zamon Store',
      phone: '+998901234567',
    });
    // shopga elchi_market_id yozildi (catalogga xabar)
    expect(catalogSend).toHaveBeenCalledWith(
      { cmd: 'catalog.shop.set-elchi-market-id' },
      { shopId: '9', elchiMarketId: '500' },
    );
    // provision yozuvi 'done' + elchiMarketId
    const saved = provisionRepo.save.mock.calls.map((c) => c[0] as any);
    expect(
      saved.some((r) => r.status === 'done' && r.elchiMarketId === '500'),
    ).toBe(true);
  });

  it('TC2a: idempotent — allaqachon done bo‘lsa yangi market ochilmaydi', async () => {
    const { service, elchi, catalogSend } = makeService({
      provisionRepo: {
        findOne: jest.fn(() =>
          Promise.resolve({
            shopId: '9',
            status: 'done',
            elchiMarketId: '500',
          }),
        ),
      },
    });

    await service.onShopApproved({ shopId: '9' });

    expect(elchi.provisionMarket).not.toHaveBeenCalled();
    expect(catalogSend).not.toHaveBeenCalled();
  });

  it('TC2b: Elchi down -> failed; retry -> done, va 2x market OCHILMAYDI (idempotent)', async () => {
    const record: any = {
      shopId: '9',
      status: 'pending',
      shopName: 'Z',
      phone: 'p',
      retryCount: 0,
      elchiMarketId: null,
      lastError: null,
    };
    const provisionMarket = jest
      .fn()
      .mockRejectedValueOnce(new Error('Elchi down'))
      .mockResolvedValueOnce({ elchi_market_id: '500' });

    const { service, catalogSend, provisionRepo } = makeService({
      provisionRepo: {
        findOne: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(() => record),
        save: jest.fn((x: unknown) => Promise.resolve(x)),
        find: jest.fn(() => Promise.resolve([record])),
      },
      elchi: { provisionMarket },
    });

    // 1-urinish: Elchi down -> failed
    await service.onShopApproved({ shopId: '9', shopName: 'Z', phone: 'p' });
    expect(record.status).toBe('failed');
    expect(record.retryCount).toBe(1);
    expect(catalogSend).not.toHaveBeenCalled();

    // retry cron -> done
    const recovered = await service.retryFailedProvisions();
    expect(recovered).toBe(1);
    expect(record.status).toBe('done');
    expect(record.elchiMarketId).toBe('500');

    // 2x market OCHILMAYDI: retry ham SHU external_seller_id bilan (Elchi idempotent),
    // va provision yozuvi faqat BITTA (create 1 marta).
    expect(provisionMarket).toHaveBeenCalledTimes(2);
    expect(provisionMarket).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ external_seller_id: '9' }),
    );
    expect(provisionRepo.create).toHaveBeenCalledTimes(1);
  });

  it('TC3: geo_cache Elchi region/district bilan mos (upsert)', async () => {
    const { service, geoRepo, elchi } = makeService({
      elchi: {
        getRegions: jest.fn(() =>
          Promise.resolve([
            { id: '1', name: 'Toshkent' },
            { id: '2', name: 'Andijon' },
          ]),
        ),
        getDistricts: jest.fn(() =>
          Promise.resolve([{ id: '10', name: 'Chilonzor', region_id: '1' }]),
        ),
      },
    });

    const res = await service.syncGeoCache();

    expect(res).toEqual({ regions: 2, districts: 1 });
    expect(elchi.getRegions).toHaveBeenCalled();
    const saved = geoRepo.save.mock.calls.map((c) => c[0] as any);
    expect(saved).toContainEqual({
      kind: 'region',
      elchiId: '1',
      name: 'Toshkent',
      elchiRegionId: null,
    });
    expect(saved).toContainEqual({
      kind: 'district',
      elchiId: '10',
      name: 'Chilonzor',
      elchiRegionId: '1',
    });
  });
});
