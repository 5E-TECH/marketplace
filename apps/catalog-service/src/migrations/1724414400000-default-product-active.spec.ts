import { DefaultProductActive1724414400000 } from './1724414400000-default-product-active';

describe('DefaultProductActive1724414400000', () => {
  it('product status defaultini active qiladi va rollback qila oladi', async () => {
    const queryRunner = { query: jest.fn().mockResolvedValue(undefined) };
    const migration = new DefaultProductActive1724414400000();

    await migration.up(queryRunner as any);
    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining("SET DEFAULT 'active'"),
    );

    await migration.down(queryRunner as any);
    expect(queryRunner.query).toHaveBeenLastCalledWith(
      expect.stringContaining("SET DEFAULT 'draft'"),
    );
  });
});
