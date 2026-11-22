import { of, throwError } from 'rxjs';
import { STOCK_DEPLETED_EVENT } from '@app/common';
import { InventoryOperationsController } from './inventory-operations.controller';

/** BE-47 TC4: band qilishdan keyin bo‘sh qoldiq 0 bo‘lsa — «Offer qoldig‘i tugadi» hodisasi. */
describe('InventoryOperationsController.reserve (BE-47)', () => {
  const input = {
    orderRef: '5001',
    items: [
      { variantId: '901', quantity: 1 },
      { variantId: '902', quantity: 1 },
    ],
  } as never;

  it('qoldig‘i 0 bo‘lgan variantlar bitta hodisada; band natijasi o‘zgarmaydi', async () => {
    const inventory = {
      reserveAvailable: jest.fn(async () => ({ reserved: true })),
      available: jest.fn(async () => ({ '901': 0, '902': 3 })),
    };
    const notifications = { emit: jest.fn(() => of(undefined)) };
    const controller = new InventoryOperationsController(
      inventory as never,
      notifications as never,
    );
    await expect(controller.reserve(input)).resolves.toEqual({
      reserved: true,
    });
    expect(notifications.emit).toHaveBeenCalledWith(STOCK_DEPLETED_EVENT, {
      variantIds: ['901'],
      at: expect.any(String),
    });
  });

  it('xabar yuborilmasa ham band qilish javobi qaytadi; qoldiq bor — hodisa yo‘q', async () => {
    const inventory = {
      reserveAvailable: jest.fn(async () => ({ reserved: true })),
      available: jest.fn(async () => ({ '901': 0, '902': 0 })),
    };
    const failing = {
      emit: jest.fn(() => throwError(() => new Error('rmq uzildi'))),
    };
    await expect(
      new InventoryOperationsController(
        inventory as never,
        failing as never,
      ).reserve(input),
    ).resolves.toEqual({ reserved: true });
    const quiet = { emit: jest.fn(() => of(undefined)) };
    inventory.available.mockResolvedValueOnce({ '901': 2, '902': 1 });
    await new InventoryOperationsController(
      inventory as never,
      quiet as never,
    ).reserve(input);
    expect(quiet.emit).not.toHaveBeenCalled();
  });
});
