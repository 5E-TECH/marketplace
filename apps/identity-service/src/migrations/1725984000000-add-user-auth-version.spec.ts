import { AddUserAuthVersion1725984000000 } from './1725984000000-add-user-auth-version';

describe('AddUserAuthVersion1725984000000', () => {
  it('auth_version ustunini qo‘shadi va rollback qiladi', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const queryRunner = { query } as never;
    const migration = new AddUserAuthVersion1725984000000();

    await migration.up(queryRunner);
    expect(query.mock.calls[0][0]).toContain(
      '"auth_version" INTEGER NOT NULL DEFAULT 1',
    );

    await migration.down(queryRunner);
    expect(query.mock.calls[1][0]).toContain('DROP COLUMN IF EXISTS');
  });
});
