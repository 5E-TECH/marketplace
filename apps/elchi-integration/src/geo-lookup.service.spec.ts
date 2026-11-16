import { GeoCache } from './entities/geo-cache.entity';
import { GeoLookupService } from './geo-lookup.service';

type Row = Pick<
  GeoCache,
  'kind' | 'elchiId' | 'name' | 'satoCode' | 'elchiRegionId'
>;

const ROWS: Row[] = [
  {
    kind: 'region',
    elchiId: '1',
    name: 'Toshkent shahri',
    satoCode: '1726',
    elchiRegionId: null,
  },
  {
    kind: 'region',
    elchiId: '2',
    name: 'Andijon viloyati',
    satoCode: '1703',
    elchiRegionId: null,
  },
  {
    kind: 'district',
    elchiId: '10',
    name: 'Yunusobod tumani',
    satoCode: '1726266',
    elchiRegionId: '1',
  },
  {
    kind: 'district',
    elchiId: '11',
    name: 'Chilonzor tumani',
    satoCode: '1726294',
    elchiRegionId: '1',
  },
  {
    kind: 'district',
    elchiId: '20',
    name: 'Asaka tumani',
    satoCode: '1703206',
    elchiRegionId: '2',
  },
  {
    kind: 'district',
    elchiId: '21',
    name: 'SOATO siz tuman',
    satoCode: null,
    elchiRegionId: '2',
  },
];

function makeService(rows: Row[] = ROWS) {
  let data = [...rows];
  const geoRepo = {
    find: jest.fn(async (opts: { where: unknown }) => {
      if (!Array.isArray(opts.where)) return data;
      const clauses = opts.where as Array<{ kind: string; satoCode: string }>;
      return data.filter((r) =>
        clauses.some((c) => c.kind === r.kind && c.satoCode === r.satoCode),
      );
    }),
    count: jest.fn(async () => data.length),
  };
  const integration = {
    syncGeoCache: jest.fn(async () => {
      data = [...ROWS];
    }),
  };
  const service = new GeoLookupService(geoRepo as never, integration as never);
  return { service, geoRepo, integration };
}

describe('GeoLookupService (BE-38)', () => {
  it('tuman shu viloyatniki — nomlar va Elchi ID lari bilan', async () => {
    const { service } = makeService();
    await expect(
      service.resolveAddress({ regionSoato: '1726', districtSoato: '1726266' }),
    ).resolves.toEqual({
      ok: true,
      regionSoato: '1726',
      regionName: 'Toshkent shahri',
      districtSoato: '1726266',
      districtName: 'Yunusobod tumani',
      elchiRegionId: '1',
      elchiDistrictId: '10',
    });
  });

  it('TC2: boshqa viloyat tumani → districtSoato xatosi', async () => {
    const { service } = makeService();
    await expect(
      service.resolveAddress({ regionSoato: '1726', districtSoato: '1703206' }),
    ).resolves.toEqual({
      ok: false,
      field: 'districtSoato',
      error: 'districtSoato tanlangan viloyatga tegishli emas',
    });
  });

  it('noma’lum viloyat yoki tuman — maydon nomi bilan xato', async () => {
    const { service } = makeService();
    await expect(
      service.resolveAddress({ regionSoato: '9999', districtSoato: '1726266' }),
    ).resolves.toMatchObject({ ok: false, field: 'regionSoato' });
    await expect(
      service.resolveAddress({ regionSoato: '1726', districtSoato: '1726999' }),
    ).resolves.toMatchObject({ ok: false, field: 'districtSoato' });
  });

  it('kesh to‘la bo‘lsa noto‘g‘ri kod Elchi bilan sinxronlashni chaqirmaydi', async () => {
    const { service, integration } = makeService();
    await service.resolveAddress({ regionSoato: '0', districtSoato: '0' });
    expect(integration.syncGeoCache).not.toHaveBeenCalled();
  });

  it('kesh bo‘sh bo‘lsa bir marta sinxronlab, qayta qidiradi', async () => {
    const { service, integration } = makeService([]);
    await expect(
      service.resolveAddress({ regionSoato: '1703', districtSoato: '1703206' }),
    ).resolves.toMatchObject({ ok: true, districtName: 'Asaka tumani' });
    expect(integration.syncGeoCache).toHaveBeenCalledTimes(1);
  });

  it('daraxt: viloyat → tumanlar; SOATO siz qator ro‘yxatga chiqmaydi', async () => {
    const { service, integration } = makeService(
      ROWS.filter((r) => r.satoCode),
    );
    await expect(service.regionTree()).resolves.toEqual([
      {
        satoCode: '1726',
        name: 'Toshkent shahri',
        districts: [
          { satoCode: '1726266', name: 'Yunusobod tumani' },
          { satoCode: '1726294', name: 'Chilonzor tumani' },
        ],
      },
      {
        satoCode: '1703',
        name: 'Andijon viloyati',
        districts: [{ satoCode: '1703206', name: 'Asaka tumani' }],
      },
    ]);
    expect(integration.syncGeoCache).not.toHaveBeenCalled();
  });

  it('daraxt: kesh bo‘sh yoki SOATO yetishmasa sinxronlaydi', async () => {
    const { service, integration } = makeService([]);
    const tree = await service.regionTree();
    expect(integration.syncGeoCache).toHaveBeenCalledTimes(1);
    expect(tree.map((r) => r.satoCode)).toEqual(['1726', '1703']);
    expect(tree[1].districts.map((d) => d.name)).toEqual(['Asaka tumani']);
  });
});
