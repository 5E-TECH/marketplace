import { BadRequestException } from '@nestjs/common';
import { ActivityLogService } from './activity-log.service';

describe('ActivityLogService (C6.3)', () => {
  function setup(rows: unknown[] = [], total = rows.length) {
    const qb = {
      where: jest.fn(),
      andWhere: jest.fn(),
      orderBy: jest.fn(),
      addOrderBy: jest.fn(),
      skip: jest.fn(),
      take: jest.fn(),
      getManyAndCount: jest.fn().mockResolvedValue([rows, total]),
    };
    for (const method of [
      'where',
      'andWhere',
      'orderBy',
      'addOrderBy',
      'skip',
      'take',
    ]) {
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
    expect(qb.addOrderBy).toHaveBeenCalledWith('log.id', 'DESC');
    expect(qb.where).toHaveBeenCalledWith('log.is_deleted = FALSE');
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
    expect(qb.andWhere).toHaveBeenCalledWith('log.created_at < :dateTo', {
      dateTo: new Date('2026-09-08T00:00:00.000Z'),
    });
  });

  it('aniq vaqt berilganda timezone va inklyuziv chegara saqlanadi', async () => {
    const { service, qb } = setup();
    await service.list({ dateTo: '2026-09-07T12:30:00+05:00' });
    expect(qb.andWhere).toHaveBeenCalledWith('log.created_at <= :dateTo', {
      dateTo: new Date('2026-09-07T07:30:00Z'),
    });
  });

  it('bo‘sh jurnal default sahifalash bilan qaytadi', async () => {
    const { service, qb } = setup();
    await expect(service.list({})).resolves.toEqual({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
    expect(qb.andWhere).not.toHaveBeenCalled();
  });

  it.each([
    { actorId: 'abc' },
    { actorId: '9223372036854775808' },
    { dateFrom: 'invalid' },
    { dateFrom: '2026-09-09', dateTo: '2026-09-07' },
    { dateFrom: '2026-09-08', dateTo: '2026-09-07' },
    { page: Number.NaN },
    { page: Number.MAX_SAFE_INTEGER, limit: 100 },
  ])('noto‘g‘ri filtr bazaga yetib bormaydi: %j', async (query) => {
    const { service, qb } = setup();
    await expect(service.list(query)).rejects.toThrow(BadRequestException);
    expect(qb.getManyAndCount).not.toHaveBeenCalled();
  });

  it('bir kun oralig‘i va katta actorId aniqligi saqlanadi', async () => {
    const { service, qb } = setup();
    await service.list({
      actorId: '9223372036854775807',
      dateFrom: '2026-09-07',
      dateTo: '2026-09-07',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('log.actor_id = :actorId', {
      actorId: '9223372036854775807',
    });
  });
});
