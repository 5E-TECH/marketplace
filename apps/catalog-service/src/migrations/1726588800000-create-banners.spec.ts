import { CreateBanners1726588800000 } from './1726588800000-create-banners';

describe('CreateBanners1726588800000', () => {
  it('banner jadvali, muddat cheklovi va indekslarni yaratadi', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new CreateBanners1726588800000();

    await migration.up({ query } as never);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('"catalog"."banner"'),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('chk_catalog_banner_period'),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('idx_catalog_banner_visible'),
    );
  });

  it('down jadval va indekslarni qaytaradi', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new CreateBanners1726588800000().down({ query } as never);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('DROP INDEX'));
    expect(query).toHaveBeenCalledWith(expect.stringContaining('DROP TABLE'));
  });
});
