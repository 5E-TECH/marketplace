import { ForbiddenException } from '@nestjs/common';
import { LeadOrderActorType, Role } from '@app/common';
import { SellerOrdersController } from './seller-orders.controller';

describe('checkout.admin.order-cancel (BE-18)', () => {
  const make = (isLead: boolean) => {
    const orders = {
      adminCancelOrder: jest.fn(async () => ({
        id: '9',
        status: 'CANCELLED',
        idempotent: false,
      })),
    };
    const leadOrders = {
      isLeadOrder: jest.fn(async () => isLead),
      cancel: jest.fn(async () => ({
        id: '9',
        status: 'CANCELLED',
        previousStatus: 'CONFIRMED',
        idempotent: false,
      })),
    };
    const controller = new SellerOrdersController(
      orders as never,
      {} as never,
      leadOrders as never,
      {} as never,
    );
    return { controller, orders, leadOrders };
  };

  it('lid buyurtmasi — yangi holatlar mashinasi orqali, aktor roli bilan', async () => {
    const { controller, orders, leadOrders } = make(true);
    await expect(
      controller.adminCancelOrder({
        orderId: '9',
        reason: 'Mijoz rad etdi',
        actorId: '3',
        actorRole: Role.SUPERVISOR,
      }),
    ).resolves.toEqual({ id: '9', status: 'CANCELLED', idempotent: false });
    expect(leadOrders.cancel).toHaveBeenCalledWith({
      orderId: '9',
      reason: 'Mijoz rad etdi',
      actor: { type: LeadOrderActorType.USER, id: '3', role: Role.SUPERVISOR },
    });
    expect(orders.adminCancelOrder).not.toHaveBeenCalled();
  });

  it('eski buyurtmani (to‘lovi bilan) nazoratchi bekor qila olmaydi — 403; admin — eski tartib', async () => {
    const { controller, orders } = make(false);
    await expect(
      controller.adminCancelOrder({
        orderId: '9',
        reason: 'Sabab',
        actorId: '3',
        actorRole: Role.SUPERVISOR,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(orders.adminCancelOrder).not.toHaveBeenCalled();
    await controller.adminCancelOrder({
      orderId: '9',
      reason: 'Sabab',
      actorId: '1',
      actorRole: Role.ADMIN,
    });
    expect(orders.adminCancelOrder).toHaveBeenCalled();
  });
});
