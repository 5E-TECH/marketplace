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
});
