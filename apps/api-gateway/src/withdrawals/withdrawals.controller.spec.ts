import { of } from 'rxjs';
import { Role, ROLES_KEY } from '@app/common';
import { AdminWithdrawalsController } from './admin-withdrawals.controller';
import { AffiliateWithdrawalsController } from './affiliate-withdrawals.controller';

describe('BE-23: pul yechish endpointlari finance-service ga', () => {
  const make = () => {
    const send = jest.fn(() => of({ ok: true }));
    return { send, client: { send } as never };
  };

  it('sotuvchi: ID tokendan, so‘rovdan emas', async () => {
    const { send, client } = make();
    const c = new AffiliateWithdrawalsController(client);
    await c.balance('42');
    expect(send).toHaveBeenLastCalledWith(
      { cmd: 'finance.withdrawal.balance' },
      { affiliateId: '42' },
    );
    await c.create('42', { amount: 1_000_000 });
    expect(send).toHaveBeenLastCalledWith(
      { cmd: 'finance.withdrawal.create' },
      { affiliateId: '42', amount: 1_000_000 },
    );
    await c.list('42', { page: 2 });
    expect(send).toHaveBeenLastCalledWith(
      { cmd: 'finance.withdrawal.list-mine' },
      { affiliateId: '42', query: { page: 2 } },
    );
  });

  it('moliya: xodim ID si tokendan; tasdiq, rad, «To‘landi» va maqom — FINANCE va SUPERADMIN (BE-05)', async () => {
    const { send, client } = make();
    const identity = {
      send: jest.fn(() => of({ firstName: 'Jasur', lastName: ' Tursunov ' })),
    };
    const c = new AdminWithdrawalsController(client, identity as never);
    await c.approve('12', '7');
    expect(send).toHaveBeenLastCalledWith(
      { cmd: 'finance.withdrawal.approve' },
      { id: '12', approverId: '7' },
    );
    await c.reject('12', '7', { reason: 'Karta xato' });
    expect(send).toHaveBeenLastCalledWith(
      { cmd: 'finance.withdrawal.reject' },
      { id: '12', rejectedBy: '7', reason: 'Karta xato' },
    );
    await c.paid('12', '8');
    expect(send).toHaveBeenLastCalledWith(
      { cmd: 'finance.withdrawal.paid' },
      { id: '12', paidBy: '8' },
    );
    await c.setSelfEmployed('42', '7', { selfEmployed: true });
    expect(send).toHaveBeenLastCalledWith(
      { cmd: 'finance.affiliate.self-employed.set' },
      {
        affiliateId: '42',
        selfEmployed: true,
        updatedBy: '7',
        fullName: 'Jasur Tursunov',
      },
    );
    identity.send.mockReturnValueOnce(of({ firstName: '', lastName: '' }));
    await expect(
      c.setSelfEmployed('42', '7', { selfEmployed: true }),
    ).rejects.toMatchObject({
      response: { errorCode: 'PROFILE_NAME_REQUIRED' },
    });
    const roles = (m: keyof AdminWithdrawalsController) =>
      Reflect.getMetadata(ROLES_KEY, AdminWithdrawalsController.prototype[m]);
    for (const m of ['approve', 'reject', 'paid', 'setSelfEmployed'] as const)
      expect(roles(m)).toEqual([Role.FINANCE, Role.SUPERADMIN]);
    expect(roles('list')).toEqual([Role.ADMIN, Role.FINANCE, Role.SUPERADMIN]);
  });

  it('BE-24 TC4: «To‘landi» dan keyin notification ga finance.withdrawal.paid (sotuvchiga SMS)', async () => {
    const dto = {
      id: '5',
      affiliateId: '42',
      amount: 6000000,
      taxAmount: 60000,
      netAmount: 5940000,
    };
    const finance = { send: jest.fn(() => of(dto)) };
    const notification = { emit: jest.fn(() => of(undefined)) };
    const c = new AdminWithdrawalsController(
      finance as never,
      {} as never,
      notification as never,
    );
    await expect(c.paid('5', '7')).resolves.toEqual(dto);
    expect(notification.emit).toHaveBeenCalledWith('finance.withdrawal.paid', {
      withdrawalId: '5',
      affiliateId: '42',
      amount: 6000000,
      tax: 60000,
      net: 5940000,
    });
  });
});
