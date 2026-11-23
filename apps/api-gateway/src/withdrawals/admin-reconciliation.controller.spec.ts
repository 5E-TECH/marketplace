import { of } from 'rxjs';
import { ELCHI_CHECK_RPC, ElchiCheckReason, Role } from '@app/common';
import { AdminReconciliationController } from './admin-reconciliation.controller';

/** BE-46 TC3: Elchi bilan avtomatik tekshiruv — gateway yo‘llari moliyaga uzatadi va amallarni auditga yozadi. */
describe('AdminReconciliationController — Elchi tekshiruvi (BE-46)', () => {
  const financeSend = jest.fn();
  const identitySend = jest.fn(() => of(undefined));
  const controller = new AdminReconciliationController(
    { send: financeSend } as never,
    { send: identitySend } as never,
  );
  const user = { sub: '6', role: Role.FINANCE } as never;

  beforeEach(() => {
    financeSend.mockReset();
    identitySend.mockClear();
  });

  it('natija va ro‘yxat so‘rovlari moliyaga o‘zgarishsiz boradi', async () => {
    financeSend.mockReturnValueOnce(of({ id: '41' }));
    await expect(
      controller.elchiCheck({ date: '2026-12-03' }),
    ).resolves.toEqual({
      id: '41',
    });
    expect(financeSend).toHaveBeenLastCalledWith(
      { cmd: ELCHI_CHECK_RPC.GET },
      { date: '2026-12-03' },
    );
    financeSend.mockReturnValueOnce(of({ items: [] }));
    const query = { runId: '41', state: undefined, page: 2, limit: 50 };
    await controller.elchiCheckItems(query as never);
    expect(financeSend).toHaveBeenLastCalledWith(
      { cmd: ELCHI_CHECK_RPC.ITEMS },
      { query },
    );
  });

  it('qo‘lda ishga tushirish: kim ishga tushirgani moliyaga va auditga', async () => {
    financeSend.mockReturnValueOnce(of({ accepted: true }));
    await expect(
      controller.elchiCheckRun(user, '203.0.113.7'),
    ).resolves.toEqual({
      accepted: true,
    });
    expect(financeSend).toHaveBeenCalledWith(
      { cmd: ELCHI_CHECK_RPC.RUN },
      { userId: '6' },
    );
    expect(identitySend).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({
        actorId: '6',
        action: 'finance.elchi-check.run',
        meta: { ip: '203.0.113.7' },
      }),
    );
  });

  it('farqni yopish: izoh moliyaga, audit — buyurtma, sabablar va izoh bilan', async () => {
    financeSend.mockReturnValueOnce(
      of({ id: '905', orderId: '1042', reasons: [ElchiCheckReason.STATUS] }),
    );
    await controller.elchiCheckResolve(
      '905',
      { comment: 'Elchi webhookni qayta yuboradi' },
      user,
      '203.0.113.7',
    );
    expect(financeSend).toHaveBeenCalledWith(
      { cmd: ELCHI_CHECK_RPC.RESOLVE },
      { id: '905', comment: 'Elchi webhookni qayta yuboradi', userId: '6' },
    );
    expect(identitySend).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      {
        actorId: '6',
        action: 'finance.elchi-check.resolve',
        entityType: 'ElchiCheckItem',
        entityId: '905',
        meta: {
          orderId: '1042',
          reasons: [ElchiCheckReason.STATUS],
          comment: 'Elchi webhookni qayta yuboradi',
          ip: '203.0.113.7',
        },
      },
    );
  });
});
