import { ConflictException } from '@nestjs/common';
import { of } from 'rxjs';
import {
  INBOUND_RPC,
  LEAD_ORDER_RPC,
  Role,
  ROLES_KEY,
  WAREHOUSE_RPC,
} from '@app/common';
import { WarehouseReturnsController } from './warehouse-returns.controller';

describe('WarehouseReturnsController (BE-17)', () => {
  const user = { sub: '61', role: Role.WAREHOUSE } as never;
  const dto = { items: [{ variantId: '846', sellable: 1, defective: 1 }] };
  const make = (status: string) => {
    const checkout = {
      send: jest.fn(({ cmd }: { cmd: string }) =>
        of(
          cmd === WAREHOUSE_RPC.RETURN_INFO
            ? { orderId: '7101', status, parcelId: '55', shipmentId: '1251177' }
            : { id: '7101', status: 'RETURNED_GRADED' },
        ),
      ),
    };
    const inventory = {
      send: jest.fn(() => of({ orderId: '7101', items: dto.items })),
    };
    const identity = { send: jest.fn(() => of(null)) };
    return {
      checkout,
      inventory,
      controller: new WarehouseReturnsController(
        checkout as never,
        inventory as never,
        identity as never,
      ),
    };
  };

  it('saralash — faqat omborchi va superadmin (TZ rollar jadvali)', () => {
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        WarehouseReturnsController.prototype.grade,
      ),
    ).toEqual([Role.WAREHOUSE, Role.SUPERADMIN]);
  });

  it('«Qaytmoqda» — avval ombor (saralash), keyin buyurtma «Saralandi»', async () => {
    const { controller, checkout, inventory } = make('RETURNING');
    await controller.grade('7101', dto, user, '1.2.3.4');
    expect(inventory.send).toHaveBeenCalledWith(
      { cmd: INBOUND_RPC.RETURN_GRADE },
      expect.objectContaining({
        orderRef: '7101',
        parcelId: '55',
        actorId: '61',
      }),
    );
    expect(checkout.send).toHaveBeenLastCalledWith(
      { cmd: LEAD_ORDER_RPC.TRANSITION },
      expect.objectContaining({
        orderId: '7101',
        to: 'RETURNED_GRADED',
        actor: { type: 'USER', id: '61', role: Role.WAREHOUSE },
      }),
    );
  });

  it('allaqachon saralangan — o‘sha natija, qayta saralanmaydi', async () => {
    const { controller, inventory } = make('RETURNED_GRADED');
    await controller.grade('7101', dto, user, '1.2.3.4');
    expect(inventory.send).toHaveBeenCalledWith(
      { cmd: INBOUND_RPC.RETURN_GET },
      { orderRef: '7101' },
    );
    expect(inventory.send).toHaveBeenCalledTimes(1);
  });

  it('«Qaytmoqda» emas (masalan, yetkazilgan) — 409, ombor o‘zgarmaydi', async () => {
    const { controller, inventory } = make('DELIVERED');
    await expect(
      controller.grade('7101', dto, user, '1.2.3.4'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(inventory.send).not.toHaveBeenCalled();
  });
});
