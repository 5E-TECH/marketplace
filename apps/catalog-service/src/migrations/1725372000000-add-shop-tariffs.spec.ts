import { AddShopTariffs1725372000000 } from './1725372000000-add-shop-tariffs';

describe('AddShopTariffs1725372000000', () => {
  it('tariff_home va tariff_center ustunlarini yaratadi/qaytaradi', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new AddShopTariffs1725372000000();

    await migration.up({ query } as never);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('tariff_home'));
    expect(query).toHaveBeenCalledWith(expect.stringContaining('25000'));
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('tariff_center'),
    );
    expect(query).toHaveBeenCalledWith(expect.stringContaining('15000'));

    query.mockClear();
    await migration.down({ query } as never);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('DROP COLUMN'));
  });
});
