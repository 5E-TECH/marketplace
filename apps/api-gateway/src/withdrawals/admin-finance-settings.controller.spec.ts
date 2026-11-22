import { of, throwError } from 'rxjs';
import { Role, ROLES_KEY } from '@app/common';
import { AdminFinanceSettingsController } from './admin-finance-settings.controller';

describe('BE-27: moliya sozlamalari (gateway)', () => {
  const user = { sub: '7', role: Role.SUPERADMIN } as never;
  const result = {
    key: 'refusal_fee',
    before: 20000,
    after: 25000,
    effectiveFrom: '2026-12-01T00:00:00.000Z',
  };

  it('ko‘rish — FINANCE, ADMIN, SUPERADMIN; o‘zgartirish — faqat SUPERADMIN', () => {
    const proto = AdminFinanceSettingsController.prototype;
    expect(Reflect.getMetadata(ROLES_KEY, proto.list)).toEqual([
      Role.FINANCE,
      Role.ADMIN,
      Role.SUPERADMIN,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, proto.set)).toEqual([
      Role.SUPERADMIN,
    ]);
  });

  it('TC1: o‘zgarish auditga — kim, eski va yangi qiymat, kuchga kirish, izoh', async () => {
    const finance = { send: jest.fn(() => of(result)) };
    const identity = { send: jest.fn(() => of({ id: '1' })) };
    const ctrl = new AdminFinanceSettingsController(
      finance as never,
      identity as never,
    );

    await expect(
      ctrl.set(
        user,
        'refusal_fee' as never,
        {
          value: 25000,
          effectiveFrom: '2026-12-01T05:00:00+05:00',
          comment: 'Moliya so‘rovi (Dilnoza)',
        },
        '1.2.3.4',
      ),
    ).resolves.toEqual(result);
    expect(finance.send).toHaveBeenCalledWith(
      { cmd: 'finance.settings.set' },
      {
        key: 'refusal_fee',
        value: 25000,
        effectiveFrom: '2026-12-01T05:00:00+05:00',
        actorId: '7',
        comment: 'Moliya so‘rovi (Dilnoza)',
      },
    );
    expect(identity.send).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      {
        actorId: '7',
        action: 'finance.setting.update',
        entityType: 'FinanceSetting',
        entityId: 'refusal_fee',
        meta: {
          before: 20000,
          after: 25000,
          effectiveFrom: '2026-12-01T00:00:00.000Z',
          comment: 'Moliya so‘rovi (Dilnoza)',
          ip: '1.2.3.4',
        },
      },
    );
  });

  it('audit bir marta qayta uriniladi', async () => {
    const identity = {
      send: jest
        .fn()
        .mockReturnValueOnce(throwError(() => new Error('rmq')))
        .mockReturnValue(of({ id: '1' })),
    };
    const ctrl = new AdminFinanceSettingsController(
      { send: jest.fn(() => of(result)) } as never,
      identity as never,
    );
    await ctrl.set(
      user,
      'refusal_fee' as never,
      { value: 1, comment: 'abc' },
      '',
    );
    expect(identity.send).toHaveBeenCalledTimes(2);
  });

  it('bekor qilish — moliyaga va auditga (nima bekor qilindi, izoh)', async () => {
    const cancelled = {
      value: 25000,
      effectiveFrom: '2026-12-01T00:00:00.000Z',
      changedBy: 'user:7',
    };
    const finance = { send: jest.fn(() => of(cancelled)) };
    const identity = { send: jest.fn(() => of({ id: '1' })) };
    const ctrl = new AdminFinanceSettingsController(
      finance as never,
      identity as never,
    );
    await expect(
      ctrl.cancel(
        user,
        'refusal_fee' as never,
        { effectiveFrom: cancelled.effectiveFrom, comment: 'Xato kiritilgan' },
        '',
      ),
    ).resolves.toEqual(cancelled);
    expect(finance.send).toHaveBeenCalledWith(
      { cmd: 'finance.settings.cancel' },
      { key: 'refusal_fee', effectiveFrom: cancelled.effectiveFrom },
    );
    expect(identity.send).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({
        action: 'finance.setting.cancel',
        meta: expect.objectContaining({
          cancelled,
          comment: 'Xato kiritilgan',
        }),
      }),
    );
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        AdminFinanceSettingsController.prototype.cancel,
      ),
    ).toEqual([Role.SUPERADMIN]);
  });

  it('audit yozilmasa ham saqlangan sozlama javobi qaytadi (xato logda)', async () => {
    const ctrl = new AdminFinanceSettingsController(
      { send: jest.fn(() => of(result)) } as never,
      { send: jest.fn(() => throwError(() => new Error('rmq'))) } as never,
    );
    await expect(
      ctrl.set(
        user,
        'refusal_fee' as never,
        { value: 25000, comment: 'abc' },
        '',
      ),
    ).resolves.toEqual(result);
  });
});
