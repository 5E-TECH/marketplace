import { of } from 'rxjs';
import { Role, ROLES_KEY } from '@app/common';
import { AdminSettlementsController } from './admin-settlements.controller';

describe('BE-33: optovik aktlari endpointlari finance-service ga', () => {
  it('yo‘naltirish; «To‘landi» xodimi tokendan; «To‘landi» va qo‘lda ishga tushirish — FINANCE va SUPERADMIN', async () => {
    const send = jest.fn(() => of({ ok: true }));
    const c = new AdminSettlementsController({ send } as never);
    await c.list({ status: undefined, periodEnd: '2027-01-10' });
    expect(send).toHaveBeenLastCalledWith(
      { cmd: 'finance.settlement.list' },
      { query: { status: undefined, periodEnd: '2027-01-10' } },
    );
    await c.get('12');
    expect(send).toHaveBeenLastCalledWith(
      { cmd: 'finance.settlement.get' },
      { id: '12' },
    );
    await c.paid('12', '7');
    expect(send).toHaveBeenLastCalledWith(
      { cmd: 'finance.settlement.paid' },
      { id: '12', paidBy: '7' },
    );
    await c.run({ asOf: '2027-01-11T04:00:00.000Z' });
    expect(send).toHaveBeenLastCalledWith(
      { cmd: 'finance.settlement.run' },
      { asOf: '2027-01-11T04:00:00.000Z' },
    );
    const roles = (m: keyof AdminSettlementsController) =>
      Reflect.getMetadata(ROLES_KEY, AdminSettlementsController.prototype[m]);
    // BE-05: moliya xodimi (FINANCE) tasdiqlaydi; ko‘rish — admin ham
    expect(roles('paid')).toEqual([Role.FINANCE, Role.SUPERADMIN]);
    expect(roles('run')).toEqual([Role.FINANCE, Role.SUPERADMIN]);
    for (const m of ['list', 'get', 'actPdf', 'bankFile'] as const)
      expect(roles(m)).toEqual([Role.ADMIN, Role.FINANCE, Role.SUPERADMIN]);
  });
});
