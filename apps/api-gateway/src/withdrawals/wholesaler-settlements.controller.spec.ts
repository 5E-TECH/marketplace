import { ForbiddenException } from '@nestjs/common';
import { Observable, of, throwError } from 'rxjs';
import {
  FINANCE_SETTLEMENT_RESPONSE_RPC,
  FINANCE_SETTLEMENT_RPC,
  Role,
  ROLES_KEY,
} from '@app/common';
import { WholesalerSettlementsController } from './wholesaler-settlements.controller';

describe('WholesalerSettlementsController (BE-46, FE-24)', () => {
  const user = { sub: '77', role: Role.WHOLESALER };

  function setup(catalogReply: () => Observable<unknown>) {
    const finance = jest.fn(
      (_pattern: unknown, _data?: unknown): Observable<unknown> =>
        of({ ok: true }),
    );
    const catalog = jest.fn(catalogReply);
    const identity = jest.fn(() => of({}));
    const controller = new WholesalerSettlementsController(
      { send: finance } as never,
      { send: catalog } as never,
      { send: identity } as never,
    );
    return { controller, finance, catalog, identity };
  }

  it('faqat WHOLESALER roli', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, WholesalerSettlementsController),
    ).toEqual([Role.WHOLESALER]);
  });

  it('optovik ID si foydalanuvchidan olinadi — so‘rovdagisi e’tiborga olinmaydi', async () => {
    const { controller, finance, catalog } = setup(() => of({ id: '501' }));
    finance.mockImplementation(() =>
      of({ items: [{ id: '12', paidBy: '17' }], total: 1 }),
    );
    const page = await controller.list(
      user as never,
      {
        page: 2,
        wholesalerId: '999',
      } as never,
    );
    expect(catalog).toHaveBeenCalledWith(
      { cmd: 'seller.shop.get-me' },
      { ownerUserId: '77' },
    );
    expect(finance).toHaveBeenCalledWith(
      { cmd: FINANCE_SETTLEMENT_RPC.LIST },
      {
        query: {
          page: 2,
          limit: undefined,
          status: undefined,
          periodEnd: undefined,
          wholesalerId: '501',
        },
      },
    );
    // platforma xodimi ID si optovikka ko‘rsatilmaydi
    expect(page.items).toEqual([{ id: '12', paidBy: null }]);
  });

  it('optovikka bog‘lanmagan foydalanuvchi — 403, moliyaga so‘rov yo‘q', async () => {
    for (const reply of [
      () => of(null),
      () =>
        throwError(() => ({
          statusCode: 404,
          message: 'Sotuvchining do‘koni topilmadi',
        })),
    ]) {
      const { controller, finance } = setup(reply);
      await expect(controller.get('12', user as never)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(finance).not.toHaveBeenCalled();
    }
  });

  it('PDF — avval egasi tekshiriladi; qabul va e’tiroz foydalanuvchi bilan yuboriladi va auditga yoziladi', async () => {
    const { controller, finance, identity } = setup(() => of({ id: '501' }));
    finance.mockImplementation(((pattern: { cmd: string }) =>
      pattern.cmd === FINANCE_SETTLEMENT_RPC.ACT_PDF
        ? of({ fileName: 'a.pdf', contentType: 'application/pdf', base64: '' })
        : of({ ok: true })) as never);
    const res = { setHeader: jest.fn() };
    await controller.actPdf('12', user as never, res as never);
    expect(finance.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      { cmd: FINANCE_SETTLEMENT_RESPONSE_RPC.WHOLESALER_GET },
      { cmd: FINANCE_SETTLEMENT_RPC.ACT_PDF },
    ]);

    finance.mockClear();
    await controller.accept('12', user as never, '1.2.3.4');
    await controller.dispute(
      '12',
      { comment: 'Mos emas' },
      user as never,
      '1.2.3.4',
    );
    expect(finance.mock.calls).toEqual([
      [
        { cmd: FINANCE_SETTLEMENT_RESPONSE_RPC.ACCEPT },
        { id: '12', wholesalerId: '501', userId: '77' },
      ],
      [
        { cmd: FINANCE_SETTLEMENT_RESPONSE_RPC.DISPUTE },
        { id: '12', wholesalerId: '501', userId: '77', comment: 'Mos emas' },
      ],
    ]);
    expect(
      identity.mock.calls.map(
        (c) => ((c as unknown[])[1] as { action: string }).action,
      ),
    ).toEqual(['settlement.accept', 'settlement.dispute']);
  });
});
