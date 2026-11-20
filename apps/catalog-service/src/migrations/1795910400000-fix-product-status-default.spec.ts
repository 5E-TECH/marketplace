import { FixProductStatusDefault1795910400000 } from './1795910400000-fix-product-status-default';

describe('FixProductStatusDefault1795910400000', () => {
  it('product status sukutini CHECK va entity bilan bir xil ACTIVE qiladi va rollback qila oladi', async () => {
    const queryRunner = { query: jest.fn().mockResolvedValue(undefined) };
    const migration = new FixProductStatusDefault1795910400000();

    await migration.up(queryRunner as never);
    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining("SET DEFAULT 'ACTIVE'"),
    );

    await migration.down(queryRunner as never);
    expect(queryRunner.query).toHaveBeenLastCalledWith(
      expect.stringContaining("SET DEFAULT 'active'"),
    );
  });
});
