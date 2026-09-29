import { of } from 'rxjs';
import { ReturnRequestsController } from './return-requests.controller';

describe('ReturnRequestsController (C4.2)', () => {
  function setup() {
    const returns = { transition: jest.fn(), create: jest.fn() };
    const refunds = { refund: jest.fn() };
    const queries = { list: jest.fn(), get: jest.fn() };
    const catalog = { send: jest.fn(() => of({ id: '7' })) };
    const controller = new ReturnRequestsController(
      returns as never,
      refunds as never,
      queries as never,
      catalog as never,
    );
    return { controller, returns, refunds, queries, catalog };
  }

  const actor = { id: '70', role: 'SELLER' };

  it('owner scope catalog orqali do‘konga aylanadi va faqat shu do‘konda amal qiladi', async () => {
    const { controller, returns, catalog } = setup();
    await controller.sellerApprove({
      ownerUserId: '70',
      returnId: '3',
      actor,
      comment: 'OK',
    });
    expect(catalog.send).toHaveBeenCalledWith(
      { cmd: 'seller.shop.get-me' },
      { ownerUserId: '70' },
    );
    expect(returns.transition).toHaveBeenCalledWith('sellerApprove', {
      returnId: '3',
      actor,
      comment: 'OK',
      shopId: '7',
    });
  });

  it('operator shopId to‘g‘ridan ishlatiladi', async () => {
    const { controller, queries, catalog } = setup();
    await controller.sellerList({ shopId: '9', query: { page: 1, limit: 5 } });
    expect(catalog.send).not.toHaveBeenCalled();
    expect(queries.list).toHaveBeenCalledWith({
      page: 1,
      limit: 5,
      shopId: '9',
    });
  });

  it('xaridor ro‘yxati customerId bilan cheklanadi, admin refund summa/restock oladi', async () => {
    const { controller, queries, refunds } = setup();
    await controller.listByBuyer({
      customerId: '5',
      query: { customerId: '999' } as never,
    });
    expect(queries.list).toHaveBeenCalledWith({ customerId: '5' });

    await controller.adminRefund({
      returnId: '3',
      actor: { id: '1', role: 'SUPERADMIN' },
      amount: 1000,
      restock: false,
    });
    expect(refunds.refund).toHaveBeenCalledWith({
      returnId: '3',
      actor: { id: '1', role: 'SUPERADMIN' },
      comment: null,
      amount: 1000,
      restock: false,
    });
  });
});
