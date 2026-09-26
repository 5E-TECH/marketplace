import { Role, ROLES_KEY } from '@app/common';
import { of } from 'rxjs';
import { SellerOrdersController } from './seller-orders.controller';

describe('SellerOrdersController', () => {
  it('orders/updateOrder SELLER+OPERATOR, dashboard faqat SELLER', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, SellerOrdersController.prototype.orders),
    ).toEqual([Role.SELLER, Role.OPERATOR]);
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        SellerOrdersController.prototype.updateOrder,
      ),
    ).toEqual([Role.SELLER, Role.OPERATOR]);
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        SellerOrdersController.prototype.dashboard,
      ),
    ).toEqual([Role.SELLER]);
  });

  it('JWT actor ID sini orders RPC payloadga uzatadi', () => {
    const send = jest.fn(() => of({}));
    const controller = new SellerOrdersController({ send } as never);

    controller.orders({ sub: '401', role: Role.SELLER } as never, {
      page: 1,
      limit: 20,
    });

    expect(send).toHaveBeenCalledWith(
      { cmd: 'seller.orders.list' },
      { ownerUserId: '401', query: { page: 1, limit: 20 } },
    );
  });

  it('JWT actor ID sini dashboard RPC payloadga uzatadi', () => {
    const send = jest.fn(() => of({}));
    const controller = new SellerOrdersController({ send } as never);

    controller.dashboard({ sub: '401', role: Role.SELLER } as never);

    expect(send).toHaveBeenCalledWith(
      { cmd: 'seller.dashboard.get' },
      { ownerUserId: '401' },
    );
  });

  it('C1.45: seller o‘z buyurtmasining PDF yorlig‘ini yuklaydi', async () => {
    const pdf = Buffer.from('%PDF-test');
    const send = jest.fn(() =>
      of({
        fileName: 'shipment-1251131.pdf',
        contentType: 'application/pdf',
        base64: pdf.toString('base64'),
      }),
    );
    const controller = new SellerOrdersController({ send } as never);

    const result = await controller.label(
      { sub: '401', role: Role.SELLER } as never,
      '9',
      { setHeader: jest.fn() } as never,
    );

    expect(send).toHaveBeenCalledWith(
      { cmd: 'seller.orders.label' },
      { ownerUserId: '401', orderId: '9' },
    );
    expect(result.getHeaders()).toMatchObject({
      type: 'application/pdf',
      disposition: 'attachment; filename="shipment-1251131.pdf"',
    });
  });
});
