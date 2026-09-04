import { Role } from '@app/common';
import { AdminSeeder } from './admin.seeder';

describe('AdminSeeder (C4.7)', () => {
  it('TC2: mavjud telefonni faol SUPERADMIN ga aylantiradi', async () => {
    const user = { role: Role.SELLER, isActive: false };
    const repository = {
      findOne: jest.fn().mockResolvedValue(user),
      save: jest.fn(async (value) => value),
      create: jest.fn(),
    };
    const config = {
      get: jest.fn((key: string) =>
        key === 'SEED_ADMIN_PHONE' ? '+998901234567' : '0990',
      ),
    };
    const seeder = new AdminSeeder(repository as never, config as never);

    await seeder.onApplicationBootstrap();

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ role: Role.SUPERADMIN, isActive: true }),
    );
  });
});
