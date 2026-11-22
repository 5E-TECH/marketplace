import { of } from 'rxjs';
import { Role, ROLES_KEY, SETTLEMENT_PAID_EVENT } from '@app/common';
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
    for (const m of ['list', 'get', 'actPdf'] as const)
      expect(roles(m)).toEqual([Role.ADMIN, Role.FINANCE, Role.SUPERADMIN]);
    // bank fayli aktlarni muzlatadi — to‘lov qadami (BE-05 tekshiruvi)
    expect(roles('bankFile')).toEqual([Role.FINANCE, Role.SUPERADMIN]);
  });

  it('BE-47 TC3: «To‘landi» dan keyin optovikka «Pul o‘tkazildi» hodisasi (bankka o‘tgan summa bilan)', async () => {
    const settlement = {
      id: '12',
      number: 'OPT-2026-48',
      wholesalerId: '15',
      exportedTotal: 1_250_000,
      totalAmount: 1_300_000,
      periodStart: '2026-11-16',
      periodEnd: '2026-11-22',
    };
    const emit = jest.fn(() => of(undefined));
    const c = new AdminSettlementsController(
      { send: jest.fn(() => of(settlement)) } as never,
      { emit } as never,
    );
    await expect(c.paid('12', '7')).resolves.toEqual(settlement);
    expect(emit).toHaveBeenCalledWith(SETTLEMENT_PAID_EVENT, {
      settlementId: '12',
      number: 'OPT-2026-48',
      wholesalerId: '15',
      amount: 1_250_000,
      periodStart: '2026-11-16',
      periodEnd: '2026-11-22',
    });
  });
});
