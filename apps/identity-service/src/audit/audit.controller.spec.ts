import { AuditController } from './audit.controller';

describe('AuditController (C1.31)', () => {
  it('TC1/TC2/TC4: audit yozuvini actor+action+resource bilan yaratadi', async () => {
    const log = jest.fn((x: unknown) =>
      Promise.resolve({ id: '1', ...(x as object) }),
    );
    const ctrl = new AuditController({ log } as never, {} as never);

    await ctrl.log({
      actorId: '7',
      action: 'shop.approve',
      entityType: 'Shop',
      entityId: '9',
      meta: { ip: '1.2.3.4' },
    });

    expect(log).toHaveBeenCalledWith({
      actorId: '7',
      action: 'shop.approve',
      entityType: 'Shop',
      entityId: '9',
      meta: { ip: '1.2.3.4' },
    });
  });

  it('bo‘sh/qisman payload -> default (null) qiymatlar', async () => {
    const log = jest.fn((x: unknown) => Promise.resolve(x));
    const ctrl = new AuditController({ log } as never, {} as never);

    await ctrl.log({ action: 'user.block' } as never);

    expect(log).toHaveBeenCalledWith({
      actorId: null,
      action: 'user.block',
      entityType: null,
      entityId: null,
      meta: null,
    });
  });

  it('TC3: audit faqat qo‘shadi — update/delete pattern YO‘Q (immutable)', () => {
    const ctrl = new AuditController({ log: jest.fn() } as never, {} as never);
    // Controller faqat `log` beradi; o'zgartirish/o'chirish metodi yo'q.
    expect(typeof (ctrl as unknown as { log: unknown }).log).toBe('function');
    expect((ctrl as unknown as Record<string, unknown>).update).toBeUndefined();
    expect((ctrl as unknown as Record<string, unknown>).delete).toBeUndefined();
  });

  it('C6.3: list queryni activity log servicega uzatadi', async () => {
    const list = jest.fn().mockResolvedValue({ items: [], total: 0 });
    const ctrl = new AuditController(
      { list } as never,
      { find: jest.fn(async () => []) } as never,
    );
    const query = { actorId: '7', action: 'shop.suspend', page: 1, limit: 20 };

    await ctrl.list({ query });

    expect(list).toHaveBeenCalledWith(query);
  });

  it('BE-27: ro‘yxatda actorName — foydalanuvchi ismi; tizim amali va topilmagan foydalanuvchi — null', async () => {
    const list = jest.fn(async () => ({
      items: [
        { id: '3', actorId: '7', action: 'finance.setting.update' },
        { id: '2', actorId: null, action: 'system' },
        { id: '1', actorId: '99', action: 'user.block' },
      ],
      total: 3,
      page: 1,
      limit: 20,
      totalPages: 1,
    }));
    const find = jest.fn(async () => [{ id: '7', name: ' Nodira Karimova ' }]);
    const ctrl = new AuditController({ list } as never, { find } as never);

    const page = await ctrl.list({ query: { entityType: 'Product' } });

    expect(list).toHaveBeenCalledWith({ entityType: 'Product' });
    expect(find).toHaveBeenCalledTimes(1);
    expect(page.items.map((i) => i.actorName)).toEqual([
      'Nodira Karimova',
      null,
      null,
    ]);
    expect(page.total).toBe(3);
  });
});
