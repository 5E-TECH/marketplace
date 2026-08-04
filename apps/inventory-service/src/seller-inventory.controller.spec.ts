import { StockMovementType } from './entities/inventory.enums';
import { SellerInventoryController } from './seller-inventory.controller';
import { of } from 'rxjs';

describe('SellerInventoryController stock mutations', () => {
  const catalog = {
    send: jest.fn(),
  };
  const warehouses = {
    assertOwned: jest.fn(),
  };
  const inventory = {
    inbound: jest.fn(),
    adjust: jest.fn(),
  };
  let controller: SellerInventoryController;

  beforeEach(() => {
    jest.clearAllMocks();
    catalog.send.mockReturnValue(of({ id: '15' }));
    warehouses.assertOwned.mockResolvedValue(undefined);
    controller = new SellerInventoryController(
      warehouses as never,
      {} as never,
      inventory as never,
      catalog as never,
    );
  });

  it('TC1: inbound actor bilan servisga uzatiladi', async () => {
    inventory.inbound.mockResolvedValue({
      operation: StockMovementType.INBOUND,
      onHand: 55,
      reserved: 5,
    });

    const result = await controller.inbound({
      ownerUserId: '401',
      dto: {
        variantId: '88',
        warehouseId: '3',
        quantity: 50,
        reason: 'Yangi partiya',
        idempotencyKey: 'inbound-1',
      },
    });

    expect(warehouses.assertOwned).toHaveBeenCalledWith('15', '3');
    expect(inventory.inbound).toHaveBeenCalledWith({
      variantId: '88',
      warehouseId: '3',
      quantity: 50,
      reason: 'Yangi partiya',
      actorId: '401',
      idempotencyKey: 'inbound-1',
    });
    expect(result).toEqual({
      variantId: '88',
      warehouseId: '3',
      onHand: 55,
      reserved: 5,
      available: 50,
    });
  });

  it('TC2: adjust delta, sabab va actor bilan servisga uzatiladi', async () => {
    inventory.adjust.mockResolvedValue({
      operation: StockMovementType.ADJUST,
      onHand: 45,
      reserved: 0,
    });

    await controller.adjust({
      ownerUserId: '401',
      dto: {
        variantId: '88',
        warehouseId: '3',
        delta: -5,
        reason: 'Yaroqsiz',
        idempotencyKey: 'adjust-1',
      },
    });

    expect(inventory.adjust).toHaveBeenCalledWith({
      variantId: '88',
      warehouseId: '3',
      quantityDelta: -5,
      reason: 'Yaroqsiz',
      actorId: '401',
      idempotencyKey: 'adjust-1',
    });
  });

  it('TC3: ownership tekshiruvi yiqilsa stock o‘zgarmaydi', async () => {
    warehouses.assertOwned.mockRejectedValue(new Error('forbidden'));

    await expect(
      controller.inbound({
        ownerUserId: '401',
        dto: {
          variantId: '88',
          warehouseId: '3',
          quantity: 50,
          reason: 'Kirim',
        },
      }),
    ).rejects.toThrow('forbidden');

    expect(inventory.inbound).not.toHaveBeenCalled();
  });
});
