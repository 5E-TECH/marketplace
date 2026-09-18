import { of } from 'rxjs';
import { CheckoutDeliveryDestination } from '@app/common';
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
    find: jest.fn(() => Promise.resolve([])),
    count: jest.fn(() => Promise.resolve(0)),
    create: jest.fn((x: unknown) => x),
    save: jest.fn((x: unknown) => Promise.resolve(x)),
    ...(overrides.geoRepo ?? {}),
  };
  const catalogSend =
    overrides.catalogSend ??
    jest.fn((pattern: { cmd: string }) =>
      of(
        pattern.cmd === 'catalog.shop.get-by-id'
          ? {
              id: '9',
              name: 'Zamon Store',
              phone: '+998901234567',
              regionId: '1',
              districtId: '10',
              tariffHome: 15000,
              tariffCenter: 10000,
              elchiMarketId: '500',
            }
          : { statusCode: 200 },
      ),
    );
  const elchi: AnyMock = {
    provisionMarket: jest.fn(() => Promise.resolve({ elchi_market_id: '500' })),
    getRegions: jest.fn(() => Promise.resolve([])),
    getDistricts: jest.fn(() => Promise.resolve([])),
    getTariff: jest.fn(() => Promise.resolve({ amount: 15000 })),
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
  it('C2.20: delivery tarifini Elchi clientdan oladi', async () => {
    const { service, elchi } = makeService();
    await expect(
      service.getTariff({ shopId: '9', regionId: '1', districtId: '10' }),
    ).resolves.toEqual({ amount: 15000 });
    expect(elchi.getTariff).toHaveBeenCalledWith({
      elchi_market_id: '500',
      where_deliver: 'address',
    });
  });

  it('C1.46 TC4: CENTER tanlansa Elchidan center tarifini oladi', async () => {
    const { service, elchi } = makeService();

    await service.getTariff({
      shopId: '9',
      whereDeliver: CheckoutDeliveryDestination.CENTER,
    });

    expect(elchi.getTariff).toHaveBeenCalledWith({
      elchi_market_id: '500',
      where_deliver: 'center',
    });
  });

  it('C2.20: eski do‘konda market ID bo‘lmasa preview uni provision qiladi', async () => {
    let marketId: string | null = null;
    const catalogSend = jest.fn((pattern: { cmd: string }, data: any) => {
      if (pattern.cmd === 'catalog.shop.set-elchi-market-id') {
        marketId = data.elchiMarketId;
        return of({ statusCode: 200 });
      }
      return of({
        id: '9',
        name: 'Zamon Store',
        phone: '+998901234567',
        regionId: '1',
        districtId: '10',
        elchiMarketId: marketId,
      });
    });
    const { service, elchi } = makeService({ catalogSend });

    await expect(service.getTariff({ shopId: '9' })).resolves.toEqual({
      amount: 15000,
    });
    expect(elchi.provisionMarket).toHaveBeenCalledWith(
      expect.objectContaining({ external_seller_id: '9' }),
    );
    expect(elchi.getTariff).toHaveBeenCalledWith({
      elchi_market_id: '500',
      where_deliver: 'address',
    });
  });
  it('TC1: shop.approved -> Elchi market ochiladi va shop.elchi_market_id yoziladi', async () => {
    const { service, catalogSend, elchi, provisionRepo } = makeService();

    await service.onShopApproved({
      shopId: '9',
      shopName: 'Zamon Store',
      phone: '+998901234567',
      regionId: '1',
      districtId: '10',
      tariffHome: 15000,
      tariffCenter: 10000,
    });

    expect(elchi.provisionMarket).toHaveBeenCalledWith({
      external_seller_id: '9',
      name: 'Zamon Store',
      phone: '+998901234567',
      region_id: '1',
      district_id: '10',
      tariff_home: 15000,
      tariff_center: 10000,
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

  it('C1.46: retry approve paytidagi geo va tarif snapshotini saqlab yuboradi', async () => {
    const record: any = {
      shopId: '9',
      status: 'failed',
      shopName: 'Zamon',
      phone: '+998901234567',
      regionId: '1',
      districtId: '10',
      tariffHome: 15000,
      tariffCenter: 10000,
      retryCount: 1,
      elchiMarketId: null,
      lastError: 'Elchi down',
    };
    const provisionMarket = jest.fn().mockResolvedValue({
      elchi_market_id: '500',
    });
    const { service } = makeService({
      provisionRepo: {
        find: jest.fn(() => Promise.resolve([record])),
      },
      elchi: { provisionMarket },
    });

    await expect(service.retryFailedProvisions()).resolves.toBe(1);
    expect(provisionMarket).toHaveBeenCalledWith({
      external_seller_id: '9',
      name: 'Zamon',
      phone: '+998901234567',
      region_id: '1',
      district_id: '10',
      tariff_home: 15000,
      tariff_center: 10000,
    });
  });

  it('C1.46 TC3: mavjud market tariflarini idempotent provisioning bilan yangilaydi', async () => {
    const record: any = {
      shopId: '9',
      status: 'done',
      elchiMarketId: '500',
      retryCount: 0,
      lastError: null,
    };
    const provisionMarket = jest.fn().mockResolvedValue({
      elchi_market_id: '500',
    });
    const { service } = makeService({
      provisionRepo: {
        findOne: jest.fn(() => Promise.resolve(record)),
      },
      elchi: { provisionMarket },
    });

    await expect(
      service.updateMarketTariffs({
        shopId: '9',
        shopName: 'Zamon',
        phone: '+998901234567',
        regionId: '1',
        districtId: '10',
        tariffHome: 30000,
        tariffCenter: 18000,
      }),
    ).resolves.toEqual({ updated: true, status: 'done' });
    expect(provisionMarket).toHaveBeenCalledWith({
      external_seller_id: '9',
      name: 'Zamon',
      phone: '+998901234567',
      region_id: '1',
      district_id: '10',
      tariff_home: 30000,
      tariff_center: 18000,
    });
  });

  it('C6.7 TC5: do‘konni joriy catalog ma’lumoti bilan qayta provision qiladi', async () => {
    const record: any = {
      shopId: '9',
      status: 'done',
      elchiMarketId: '500',
      retryCount: 0,
      lastError: null,
    };
    const { service, elchi } = makeService({
      provisionRepo: {
        findOne: jest.fn(() => Promise.resolve(record)),
        save: jest.fn((value: unknown) => Promise.resolve(value)),
      },
    });
    await expect(service.reprovisionMarket('9')).resolves.toEqual({
      shopId: '9',
      elchiMarketId: '500',
      status: 'done',
      reprovisioned: true,
      error: null,
    });
    expect(elchi.provisionMarket).toHaveBeenCalledWith(
      expect.objectContaining({
        external_seller_id: '9',
        tariff_home: 15000,
        tariff_center: 10000,
      }),
    );
  });

  it('C1.46 TC2: eski DONE marketlarni catalog tariflari bilan backfill qiladi', async () => {
    const records = [
      {
        shopId: '4',
        status: 'done',
        elchiMarketId: '142',
        tariffHome: 0,
        tariffCenter: 0,
        retryCount: 0,
        lastError: null,
      },
      {
        shopId: '5',
        status: 'done',
        elchiMarketId: '152',
        tariffHome: 0,
        tariffCenter: 0,
        retryCount: 0,
        lastError: null,
      },
    ];
    const catalogSend = jest.fn(
      (_pattern: { cmd: string }, input: { shopId: string }) =>
        of({
          id: input.shopId,
          name: `Shop ${input.shopId}`,
          phone: '+998901234567',
          regionId: '1',
          districtId: '10',
          tariffHome: 25000,
          tariffCenter: 15000,
          elchiMarketId: input.shopId === '4' ? '142' : '152',
        }),
    );
    const provisionMarket = jest.fn((body: { external_seller_id: string }) =>
      Promise.resolve({
        elchi_market_id: body.external_seller_id === '4' ? '142' : '152',
      }),
    );
    const { service } = makeService({
      provisionRepo: {
        find: jest.fn(() => Promise.resolve(records)),
        findOne: jest.fn((_options: unknown) => {
          const call = catalogSend.mock.calls.length;
          return Promise.resolve(records[Math.max(0, call - 1)]);
        }),
        save: jest.fn((value: unknown) => Promise.resolve(value)),
      },
      catalogSend,
      elchi: { provisionMarket },
    });

    await expect(service.syncMarketTariffs()).resolves.toEqual({
      total: 2,
      updated: 2,
      failed: 0,
    });
    expect(provisionMarket).toHaveBeenCalledTimes(2);
    expect(provisionMarket).toHaveBeenCalledWith(
      expect.objectContaining({ tariff_home: 25000, tariff_center: 15000 }),
    );
  });

  it('C1.44 TC1/TC2: 181 tuman sync bo‘ladi va har yozuv sato_code bilan saqlanadi', async () => {
    const districts = Array.from({ length: 181 }, (_, index) => ({
      id: String(index + 1),
      name: `Tuman ${index + 1}`,
      region_id: '1',
      sato_code: `1726${String(index + 1).padStart(3, '0')}`,
    }));
    const { service, geoRepo, elchi } = makeService({
      elchi: {
        getRegions: jest.fn(() =>
          Promise.resolve([
            { id: '1', name: 'Toshkent', sato_code: '1726000' },
            { id: '2', name: 'Andijon', sato_code: '1703000' },
          ]),
        ),
        getDistricts: jest.fn(() => Promise.resolve(districts)),
      },
    });

    const res = await service.syncGeoCache();

    expect(res).toEqual({
      regions: 2,
      districts: 181,
      added: 183,
      updated: 0,
      deleted: 0,
    });
    expect(elchi.getRegions).toHaveBeenCalled();
    const saved = geoRepo.save.mock.calls.map((c) => c[0] as any);
    expect(saved).toContainEqual(
      expect.objectContaining({
        kind: 'region',
        elchiId: '1',
        satoCode: '1726000',
      }),
    );
    expect(saved).toContainEqual(
      expect.objectContaining({
        kind: 'district',
        elchiId: '1',
        satoCode: '1726001',
        elchiRegionId: '1',
      }),
    );
    expect(saved.every((row) => Boolean(row.satoCode))).toBe(true);
  });

  it('C1.44 TC3: Elchida yo‘qolgan tuman is_deleted=true bo‘ladi', async () => {
    const removed: any = {
      kind: 'district',
      elchiId: '99',
      name: 'Eski tuman',
      satoCode: '1799999',
      elchiRegionId: '1',
      isDeleted: false,
    };
    const { service, geoRepo } = makeService({
      geoRepo: { find: jest.fn(() => Promise.resolve([removed])) },
      elchi: {
        getRegions: jest.fn(() =>
          Promise.resolve([
            { id: '1', name: 'Toshkent', sato_code: '1726000' },
          ]),
        ),
        getDistricts: jest.fn(() =>
          Promise.resolve([
            {
              id: '10',
              name: 'Chilonzor',
              region_id: '1',
              sato_code: '1726266',
            },
          ]),
        ),
      },
    });

    await expect(service.syncGeoCache()).resolves.toMatchObject({ deleted: 1 });
    expect(removed.isDeleted).toBe(true);
    expect(geoRepo.save).toHaveBeenCalledWith(removed);
  });

  it('C1.44 TC4: Elchidagi yangi tuman cachega qo‘shiladi', async () => {
    const { service, geoRepo } = makeService({
      elchi: {
        getRegions: jest.fn(() =>
          Promise.resolve([
            { id: '1', name: 'Toshkent', sato_code: '1726000' },
          ]),
        ),
        getDistricts: jest.fn(() =>
          Promise.resolve([
            {
              id: '181',
              name: 'Yangihayot',
              region_id: '1',
              sato_code: '1726290',
            },
          ]),
        ),
      },
    });

    await expect(service.syncGeoCache()).resolves.toMatchObject({ added: 2 });
    expect(geoRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'district',
        elchiId: '181',
        name: 'Yangihayot',
        satoCode: '1726290',
        isDeleted: false,
      }),
    );
  });

  it('C1.44: Elchi bo‘sh javobida mavjud cache o‘chirilmaydi', async () => {
    const existing = {
      kind: 'district',
      elchiId: '10',
      isDeleted: false,
    };
    const { service, geoRepo } = makeService({
      geoRepo: { find: jest.fn(() => Promise.resolve([existing])) },
    });

    await expect(service.syncGeoCache()).rejects.toThrow(
      'mavjud cache o‘zgartirilmadi',
    );
    expect(geoRepo.save).not.toHaveBeenCalled();
    expect(existing.isDeleted).toBe(false);
  });

  it('C1.44: kunlik cron geo syncni ishga tushiradi', async () => {
    const { service } = makeService();
    const sync = jest.spyOn(service, 'syncGeoCache').mockResolvedValue({
      regions: 14,
      districts: 181,
      added: 0,
      updated: 0,
      deleted: 0,
    });

    await service.syncGeoCacheDaily();

    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('getRegions keshdan viloyatlar ro‘yxatini oladi', async () => {
    const { service, geoRepo } = makeService({
      geoRepo: {
        find: jest.fn(() =>
          Promise.resolve([
            {
              id: '1',
              elchiId: '1',
              name: 'Toshkent shahri',
              satoCode: '1726000',
            },
            {
              id: '2',
              elchiId: '2',
              name: 'Samarqand viloyati',
              satoCode: '1718000',
            },
          ]),
        ),
      },
    });

    const res = await service.getRegions();
    expect(res).toEqual([
      { id: '1', name: 'Toshkent shahri', satoCode: '1726000' },
      { id: '2', name: 'Samarqand viloyati', satoCode: '1718000' },
    ]);
    expect(geoRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { kind: 'region', isDeleted: false } }),
    );
  });

  it('getDistricts keshdan tumanlar ro‘yxatini oladi', async () => {
    const { service, geoRepo } = makeService({
      geoRepo: {
        find: jest.fn(() =>
          Promise.resolve([
            {
              id: '10',
              elchiId: '10',
              elchiRegionId: '1',
              name: 'Yunusobod tumani',
              satoCode: '1726266',
            },
          ]),
        ),
      },
    });

    const res = await service.getDistricts('1');
    expect(res).toEqual([
      {
        id: '10',
        regionId: '1',
        name: 'Yunusobod tumani',
        satoCode: '1726266',
      },
    ]);
    expect(geoRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          kind: 'district',
          elchiRegionId: '1',
          isDeleted: false,
        },
      }),
    );
  });
});

describe('ElchiIntegrationService.createShipment (shopId → elchi_market_id)', () => {
  /**
   * Regressiya: `seller-orders.service.ts` marketplace'ning ICHKI do'kon
   * id'sini (4) to'g'ridan-to'g'ri `elchi_market_id` maydoniga solib yuborardi,
   * holbuki Elchi'dagi market id boshqa raqam (142). Natijada Elchi rad etardi:
   *   403 "elchi_market_id shu hamkorga tegishli emas"
   * ya'ni sotuvchi kabinetidan posilka yaratish umuman ishlamasdi.
   */
  const body = {
    external_order_id: 'seller-order-9',
    customer: { name: 'Nodira', phone: '+998901234567' },
    address: 'Toshkent',
    items: [{ name: 'Mahsulot', quantity: 1 }],
    cod_amount: 45000,
  };

  const svc = (elchiMarketId: string | null) => {
    const createShipment = jest.fn().mockResolvedValue({ shipment_id: '900' });
    const service = Object.create(
      ElchiIntegrationService.prototype,
    ) as ElchiIntegrationService;
    Object.assign(service, {
      elchi: { createShipment },
      getCatalogShop: jest.fn().mockResolvedValue({
        id: '4',
        name: 'Do‘kon',
        phone: '+998900000000',
        regionId: null,
        districtId: null,
        elchiMarketId,
      }),
      onShopApproved: jest.fn(),
    });
    return { service, createShipment };
  };

  it('shopId berilsa Elchi market id ga o‘giriladi', async () => {
    const { service, createShipment } = svc('142');
    await service.createShipment({ ...body, shopId: '4' } as never);
    const sent = createShipment.mock.calls[0][0] as {
      elchi_market_id: string;
      shopId?: string;
    };
    expect(sent.elchi_market_id).toBe('142');
    // `shopId` Elchi'ga uzatilmaydi — u faqat ichki moslashtirish uchun.
    expect(sent.shopId).toBeUndefined();
  });

  it('elchi_market_id to‘g‘ridan-to‘g‘ri berilsa tegilmaydi', async () => {
    const { service, createShipment } = svc(null);
    await service.createShipment({
      ...body,
      elchi_market_id: '137',
    } as never);
    expect(
      (createShipment.mock.calls[0][0] as { elchi_market_id: string })
        .elchi_market_id,
    ).toBe('137');
  });
});
