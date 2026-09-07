import { ActivityLogService } from './activity-log.service';

describe('ActivityLogService (C6.3)', () => {
  function setup(rows: unknown[] = [], total = rows.length) {
    const qb = {
      where: jest.fn(),
      andWhere: jest.fn(),
      orderBy: jest.fn(),
      skip: jest.fn(),
      take: jest.fn(),
      getManyAndCount: jest.fn().mockResolvedValue([rows, total]),
    };
    for (const method of ['where', 'andWhere', 'orderBy', 'skip', 'take']) {
      qb[method as keyof typeof qb] = jest.fn().mockReturnValue(qb) as never;
    }
    const repo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
    return { service: new ActivityLogService(repo as never), qb };
  }

  it('TC1: audit yozuvlarini yangi sanadan boshlab sahifalab qaytaradi', async () => {
    const item = { id: '3', actorId: '7', action: 'shop.suspend' };
    const { service, qb } = setup([item], 21);

    await expect(service.list({ page: 2, limit: 10 })).resolves.toEqual({
      items: [item],
      total: 21,
      page: 2,
      limit: 10,
      totalPages: 3,
    });
    expect(qb.orderBy).toHaveBeenCalledWith('log.created_at', 'DESC');
    expect(qb.skip).toHaveBeenCalledWith(10);
    expect(qb.take).toHaveBeenCalledWith(10);
  });

  it('TC2: actor va action filtrlari queryga qo‘shiladi', async () => {
    const { service, qb } = setup();
    await service.list({ actorId: '7', action: ' user.block ' });

    expect(qb.andWhere).toHaveBeenCalledWith('log.actor_id = :actorId', {
      actorId: '7',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('log.action = :action', {
      action: 'user.block',
    });
  });

  it('TC3: sana oralig‘i, dateTo kuni oxirigacha ishlaydi', async () => {
    const { service, qb } = setup();
    await service.list({ dateFrom: '2026-09-01', dateTo: '2026-09-07' });

    expect(qb.andWhere).toHaveBeenCalledWith('log.created_at >= :dateFrom', {
      dateFrom: new Date('2026-09-01'),
    });
    expect(qb.andWhere).toHaveBeenCalledWith('log.created_at <= :dateTo', {
      dateTo: new Date('2026-09-07T23:59:59.999Z'),
    });
  });
});
