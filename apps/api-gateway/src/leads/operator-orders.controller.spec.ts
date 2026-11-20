import { of } from 'rxjs';
import { LEAD_ORDER_RPC, Role, ROLES_KEY } from '@app/common';
import { OperatorOrdersController } from './operator-orders.controller';

describe('OperatorOrdersController (BE-18, BUY-3)', () => {
  it('operator, nazoratchi va superadmin; bekor qilish checkoutga aktor va sabab bilan, auditga yoziladi', async () => {
    expect(Reflect.getMetadata(ROLES_KEY, OperatorOrdersController)).toEqual([
      Role.OPERATOR_LEAD,
      Role.SUPERVISOR,
      Role.SUPERADMIN,
    ]);
    const checkout = {
      send: jest.fn(() =>
        of({
          id: '12',
          status: 'CANCELLED',
          previousStatus: 'CONFIRMED',
          idempotent: false,
        }),
      ),
    };
    const identity = { send: jest.fn(() => of({})) };
    const controller = new OperatorOrdersController(
      checkout as never,
      identity as never,
    );

    await expect(
      controller.cancel(
        '12',
        { reason: 'Mijoz fikridan qaytdi' },
        { sub: '41', role: Role.OPERATOR_LEAD },
        '10.0.0.1',
      ),
    ).resolves.toEqual({ id: '12', status: 'CANCELLED', idempotent: false });
    expect(checkout.send).toHaveBeenCalledWith(
      { cmd: LEAD_ORDER_RPC.CANCEL },
      {
        orderId: '12',
        reason: 'Mijoz fikridan qaytdi',
        actor: { type: 'USER', id: '41', role: Role.OPERATOR_LEAD },
      },
    );
    expect(identity.send).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({ action: 'order.cancel', entityId: '12' }),
    );
  });
});
