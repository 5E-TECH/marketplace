import { ElchiApiClient } from './elchi-api.client';

describe('ElchiApiClient config (C2.20)', () => {
  const config = (values: Record<string, string | undefined>) => ({
    getOrThrow: jest.fn((key: string) => {
      const value = values[key];
      if (value === undefined) {
        throw new TypeError(`Configuration key "${key}" does not exist`);
      }
      return value;
    }),
  });

  it('URL yo‘q bo‘lsa servis bootstrapidayoq xato beradi', () => {
    expect(
      () =>
        new ElchiApiClient(
          config({ ELCHI_PARTNER_API_KEY: 'secret-key' }) as never,
        ),
    ).toThrow('ELCHI_PARTNER_API_URL');
  });

  it('API key yo‘q bo‘lsa servis bootstrapidayoq xato beradi', () => {
    expect(
      () =>
        new ElchiApiClient(
          config({ ELCHI_PARTNER_API_URL: 'https://api.elchi.uz' }) as never,
        ),
    ).toThrow('ELCHI_PARTNER_API_KEY');
  });

  it('ikkala qiymat bo‘lsa client yaratiladi', () => {
    expect(
      new ElchiApiClient(
        config({
          ELCHI_PARTNER_API_URL: 'https://api.elchi.uz/',
          ELCHI_PARTNER_API_KEY: 'secret-key',
        }) as never,
      ),
    ).toBeInstanceOf(ElchiApiClient);
  });

  it('tarifni Elchi market ID bilan so‘raydi va market_tariffni o‘qiydi', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          data: { market_tariff: 25000 },
        }),
    } as Response);
    const client = new ElchiApiClient(
      config({
        ELCHI_PARTNER_API_URL: 'https://api.elchi.uz/',
        ELCHI_PARTNER_API_KEY: 'secret-key',
      }) as never,
    );

    await expect(
      client.getTariff({
        elchi_market_id: '77',
        where_deliver: 'address',
      }),
    ).resolves.toEqual({ amount: 25000 });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.elchi.uz/partner/tariff?elchi_market_id=77&where_deliver=address',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ 'x-api-key': 'secret-key' }),
      }),
    );
    fetchMock.mockRestore();
  });

  // Regressiya: productionda HAR QANDAY posilka yaratish 400 bilan yiqilardi —
  // baza `where_deliver` ni 'ADDRESS' (katta harf) saqlaydi, Elchi esa faqat
  // kichik harfni qabul qiladi. Bu testlar aynan shu holatni qoplaydi.
  const shipmentBody = (whereDeliver?: string) => ({
    external_order_id: 'seller-order-1',
    elchi_market_id: '77',
    customer: { name: 'Mijoz', phone: '+998901234567' },
    address: 'Toshkent sh.',
    region_id: '1',
    district_id: '1',
    ...(whereDeliver === undefined ? {} : { where_deliver: whereDeliver }),
    items: [{ name: 'Mahsulot', quantity: 1 }],
    cod_amount: 10000,
  });

  const sentBody = (fetchMock: jest.SpyInstance) =>
    JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as {
      where_deliver: string;
    };

  const shipmentClient = () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ data: { shipment_id: '55' } }),
    } as Response);
    const client = new ElchiApiClient(
      config({
        ELCHI_PARTNER_API_URL: 'https://api.elchi.uz/',
        ELCHI_PARTNER_API_KEY: 'secret-key',
      }) as never,
    );
    return { fetchMock, client };
  };

  it.each([
    ['ADDRESS', 'address'],
    ['address', 'address'],
    ['CENTER', 'center'],
    ['center', 'center'],
    [' Address ', 'address'],
  ])(
    'where_deliver "%s" Elchi kutgan "%s" ga keltiriladi',
    async (input, expected) => {
      const { fetchMock, client } = shipmentClient();
      await client.createShipment(shipmentBody(input) as never);
      expect(sentBody(fetchMock).where_deliver).toBe(expected);
      fetchMock.mockRestore();
    },
  );

  it('notanish yoki bo‘sh qiymatda xavfsiz "address" yuboriladi', async () => {
    for (const input of [undefined, '', 'uyga']) {
      const { fetchMock, client } = shipmentClient();
      await client.createShipment(shipmentBody(input) as never);
      expect(sentBody(fetchMock).where_deliver).toBe('address');
      fetchMock.mockRestore();
    }
  });
});
