import { AddGeoSatoCode1725285600000 } from './1725285600000-add-geo-sato-code';

describe('AddGeoSatoCode1725285600000', () => {
  it('sato_code ustuni va indeksini yaratadi/qaytaradi', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new AddGeoSatoCode1725285600000();

    await migration.up({ query } as never);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('sato_code'));
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('idx_integration_geo_sato_code'),
    );

    query.mockClear();
    await migration.down({ query } as never);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('DROP COLUMN'));
  });
});
