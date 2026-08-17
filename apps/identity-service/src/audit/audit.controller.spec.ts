import { AuditController } from './audit.controller';

describe('AuditController (C1.31)', () => {
  it('TC1/TC2/TC4: audit yozuvini actor+action+resource bilan yaratadi', async () => {
    const log = jest.fn((x: unknown) =>
      Promise.resolve({ id: '1', ...(x as object) }),
    );
    const ctrl = new AuditController({ log } as never);

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
    const ctrl = new AuditController({ log } as never);

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
    const ctrl = new AuditController({ log: jest.fn() } as never);
    // Controller faqat `log` beradi; o'zgartirish/o'chirish metodi yo'q.
    expect(typeof (ctrl as unknown as { log: unknown }).log).toBe('function');
    expect((ctrl as unknown as Record<string, unknown>).update).toBeUndefined();
    expect((ctrl as unknown as Record<string, unknown>).delete).toBeUndefined();
  });
});
