import { CategorySeeder } from './category.seeder';

describe('CategorySeeder (C4.7)', () => {
  it('TC2: standart kategoriyalarni idempotent yaratadi', async () => {
    const repository = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: '2' })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const seeder = new CategorySeeder(
      repository as never,
      {
        get: jest.fn(() => true),
      } as never,
    );

    await seeder.onApplicationBootstrap();

    expect(repository.findOne).toHaveBeenCalledTimes(4);
    expect(repository.save).toHaveBeenCalledTimes(3);
  });
});
