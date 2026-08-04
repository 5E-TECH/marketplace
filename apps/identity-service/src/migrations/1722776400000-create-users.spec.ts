import { QueryRunner } from 'typeorm';
import { CreateUsers1722776400000 } from './1722776400000-create-users';

describe('CreateUsers1722776400000', () => {
  it('production uchun identity.users jadvalini yaratadi', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new CreateUsers1722776400000();

    await migration.up({ query } as unknown as QueryRunner);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS "identity"."users"'),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('"phone" VARCHAR(20) NOT NULL'),
    );
  });
});
