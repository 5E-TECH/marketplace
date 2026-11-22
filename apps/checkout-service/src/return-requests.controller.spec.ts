import { ReturnRequestsController } from './return-requests.controller';

describe('ReturnRequestsController (C4.2)', () => {
  function setup() {
    const returns = { transition: jest.fn() };
    const refunds = { refund: jest.fn() };
    const queries = { list: jest.fn(), get: jest.fn() };
    const controller = new ReturnRequestsController(
      returns as never,
      refunds as never,
      queries as never,
      { isStaffRequest: jest.fn(async () => false) } as never,
    );
    return { controller, returns, refunds, queries };
  }

  it('admin ro‘yxati filtrni o‘zgarishsiz uzatadi', async () => {
    const { controller, queries } = setup();
    await controller.adminList({ query: { page: 1, limit: 5 } as never });
    expect(queries.list).toHaveBeenCalledWith({ page: 1, limit: 5 });
  });

  it('admin tasdiqlash — aktor va izoh bilan, do‘kon chegarasisiz', async () => {
    const { controller, returns } = setup();
    await controller.adminApprove({
      returnId: '3',
      actor: { id: '1', role: 'ADMIN' },
      comment: 'OK',
    });
    expect(returns.transition).toHaveBeenCalledWith('adminApprove', {
      returnId: '3',
      actor: { id: '1', role: 'ADMIN' },
      comment: 'OK',
    });
  });

  it('admin refund summa va restock oladi', async () => {
    const { controller, refunds } = setup();
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
