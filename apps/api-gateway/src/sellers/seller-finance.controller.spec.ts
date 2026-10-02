import { NotFoundException } from '@nestjs/common';
import { of } from 'rxjs';
import { Role, ROLES_KEY } from '@app/common';
import { SellerFinanceController } from './seller-finance.controller';

describe('SellerFinanceController', () => {
  const owner = { sub: '70', role: Role.SELLER };

  function setup(shop: { id: string } | null = { id: '7' }) {
    const finance = jest.fn(() => of({ ok: true }));
    const catalog = jest.fn(() => of(shop));
    const controller = new SellerFinanceController(
      { send: finance } as never,
      { send: catalog } as never,
    );
    return { controller, finance, catalog };
  }

  it('faqat do‘kon egasi (operator moliyani ko‘rmaydi)', () => {
    for (const method of [
      'ledger',
      'payouts',
      'summary',
      'getPayoutSchedule',
      'updatePayoutSchedule',
    ] as const) {
      expect(
        Reflect.getMetadata(
          ROLES_KEY,
          SellerFinanceController.prototype[method],
        ),
      ).toEqual([Role.SELLER]);
    }
  });

  it('do‘kon token egasidan aniqlanadi va query’dagi shopId ustidan yoziladi', async () => {
    const { controller, finance, catalog } = setup();

    await controller.ledger(
      owner as never,
      {
        dateFrom: '2026-09-01',
        shopId: '999',
      } as never,
    );
    await controller.payouts(owner as never, { status: 'PAID' } as never);

    expect(catalog).toHaveBeenCalledWith(
      { cmd: 'seller.shop.get-me' },
      { ownerUserId: '70' },
    );
    expect(finance).toHaveBeenNthCalledWith(
      1,
      { cmd: 'finance.ledger.list' },
      { query: { dateFrom: '2026-09-01', shopId: '7' } },
    );
    expect(finance).toHaveBeenNthCalledWith(
      2,
      { cmd: 'finance.payouts.list' },
      { query: { status: 'PAID', shopId: '7' } },
    );
  });

  it('summary va payout jadvali shu do‘kon uchun', async () => {
    const { controller, finance } = setup();

    await controller.summary(owner as never, { dateTo: '2026-09-30' });
    await controller.getPayoutSchedule(owner as never);
    await controller.updatePayoutSchedule(owner as never, {
      frequency: 'MONTHLY' as never,
    });

    expect(finance.mock.calls).toEqual([
      [
        { cmd: 'finance.seller.summary' },
        { shopId: '7', query: { dateTo: '2026-09-30' } },
      ],
      [{ cmd: 'finance.payout-schedule.get' }, { shopId: '7' }],
      [
        { cmd: 'finance.payout-schedule.update' },
        { shopId: '7', frequency: 'MONTHLY' },
      ],
    ]);
  });

  it('do‘kon topilmasa finance’ga shopId’siz so‘rov ketmaydi', async () => {
    const { controller, finance } = setup(null);
    await expect(controller.ledger(owner as never, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(finance).not.toHaveBeenCalled();
  });
});
