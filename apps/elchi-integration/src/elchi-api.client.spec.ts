import { ElchiApiClient, ElchiApiError } from './elchi-api.client';

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

  it('C1.44: region va district sato_code maydonlarini o‘qiydi', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            data: [{ id: 1, name: 'Toshkent', sato_code: 1726000 }],
          }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            data: [
              {
                id: 10,
                name: 'Chilonzor',
                region_id: 1,
                soato_code: 1726266,
              },
            ],
          }),
      } as Response);
    const client = new ElchiApiClient(
      config({
        ELCHI_PARTNER_API_URL: 'https://api.elchi.uz',
        ELCHI_PARTNER_API_KEY: 'secret-key',
      }) as never,
    );

    await expect(client.getRegions()).resolves.toEqual([
      { id: '1', name: 'Toshkent', sato_code: '1726000' },
    ]);
    await expect(client.getDistricts()).resolves.toEqual([
      {
        id: '10',
        name: 'Chilonzor',
        region_id: '1',
        sato_code: '1726266',
      },
    ]);
    fetchMock.mockRestore();
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

  const shipmentClient = (
    data: Record<string, unknown> = { shipment_id: '55' },
  ) => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ data }),
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

  it('BE-20 TC5: cancelShipment POST /partner/shipments/:id/cancel ga boradi', async () => {
    const { fetchMock, client } = shipmentClient();
    await client.cancelShipment('1251131');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.elchi.uz/partner/shipments/1251131/cancel',
      expect.objectContaining({ method: 'POST' }),
    );
    fetchMock.mockRestore();
  });

  it('BE-20: Elchi xatosi HTTP status bilan ElchiApiError', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 409,
      text: async () => 'sold',
    } as Response);
    const client = new ElchiApiClient(
      config({
        ELCHI_PARTNER_API_URL: 'https://api.elchi.uz/',
        ELCHI_PARTNER_API_KEY: 'secret-key',
      }) as never,
    );
    const error = await client.cancelShipment('1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ElchiApiError);
    expect((error as ElchiApiError).status).toBe(409);
    expect((error as ElchiApiError).code).toBeNull();
    fetchMock.mockRestore();
  });

  it('BE-20: takroriy javobda QR bo‘lmasa GET /partner/shipments/:id dan olinadi', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({ data: { shipment_id: '77', idempotent: true } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            data: { shipment_id: '77', tracking: 'qr-77', cod_amount: 276000 },
          }),
      } as Response);
    const client = new ElchiApiClient(
      config({
        ELCHI_PARTNER_API_URL: 'https://api.elchi.uz/',
        ELCHI_PARTNER_API_KEY: 'secret-key',
      }) as never,
    );
    await expect(
      client.createShipment(shipmentBody('ADDRESS') as never),
    ).resolves.toEqual({
      shipment_id: '77',
      qr_code_token: 'qr-77',
      to_be_paid: 276000,
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://api.elchi.uz/partner/shipments/77',
      expect.objectContaining({ method: 'GET' }),
    );
    fetchMock.mockRestore();
  });

  it('BE-20: ORDER_INTAKE_CLOSED kodi va reopens_at xato tanasidan o‘qiladi', () => {
    const error = new ElchiApiError(409, 'closed', {
      statusCode: 409,
      code: 'ORDER_INTAKE_CLOSED',
      reopens_at: '2026-11-18T04:00:00.000Z',
    });
    expect(error.code).toBe('ORDER_INTAKE_CLOSED');
    expect(error.reopensAt).toBe('2026-11-18T04:00:00.000Z');
  });

  it('notanish yoki bo‘sh qiymatda xavfsiz "address" yuboriladi', async () => {
    for (const input of [undefined, '', 'uyga']) {
      const { fetchMock, client } = shipmentClient();
      await client.createShipment(shipmentBody(input) as never);
      expect(sentBody(fetchMock).where_deliver).toBe('address');
      fetchMock.mockRestore();
    }
  });

  it('C1.45: javobdagi qr_code_token va to_be_paid (0 ham) qaytariladi', async () => {
    for (const [toBePaid, expected] of [
      ['45000.00', 45000],
      [0, 0],
    ] as const) {
      const { fetchMock, client } = shipmentClient({
        shipment_id: '1251131',
        order_status: 'new',
        qr_code_token: '3e3a70f78d54064348bde43a',
        to_be_paid: toBePaid,
      });
      await expect(
        client.createShipment(shipmentBody('ADDRESS') as never),
      ).resolves.toEqual({
        shipment_id: '1251131',
        qr_code_token: '3e3a70f78d54064348bde43a',
        to_be_paid: expected,
      });
      fetchMock.mockRestore();
    }
  });

  it('C1.45: getShipment Elchi `tracking`/`cod_amount` nomlaridan token va summani oladi', async () => {
    const { fetchMock, client } = shipmentClient({
      shipment_id: '1251128',
      external_order_id: '7',
      status: 'new',
      cod_amount: 38000,
      tracking: 'a1b2c3d4e5f60718293a4b5c',
    });

    await expect(client.getShipment('1251128')).resolves.toEqual({
      shipment_id: '1251128',
      qr_code_token: 'a1b2c3d4e5f60718293a4b5c',
      to_be_paid: 38000,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.elchi.uz/partner/shipments/1251128',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ 'x-api-key': 'secret-key' }),
      }),
    );
    fetchMock.mockRestore();
  });

  it('C1.45: getShipment javobida token bo‘lmasa maydon qo‘shilmaydi', async () => {
    const { fetchMock, client } = shipmentClient({
      shipment_id: '1251128',
      tracking: null,
    });

    await expect(client.getShipment('1251128')).resolves.toEqual({
      shipment_id: '1251128',
    });
    fetchMock.mockRestore();
  });
});
