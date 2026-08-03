import { NotificationEventsController } from './notification-events.controller';
import { NotificationService } from './notification.service';

describe('NotificationEventsController', () => {
  const create = jest.fn();
  const controller = new NotificationEventsController({
    create,
  } as unknown as NotificationService);

  beforeEach(() => create.mockReset().mockResolvedValue({ id: '1' }));

  it('registration eventidan in-app notification yaratadi', async () => {
    await controller.sellerRegistered({
      sellerUserId: '10',
      shopId: '20',
      sellerName: 'Ali',
      shopName: 'Ali Shop',
      phone: '+998901234567',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: expect.objectContaining({ userId: '10' }),
        type: 'register',
        data: { shopId: '20' },
      }),
    );
  });

  it('approve eventidan seller notification yaratadi', async () => {
    await controller.shopApproved({
      sellerUserId: '10',
      shopId: '20',
      shopName: 'Ali Shop',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'shop_approved' }),
    );
  });

  it('order eventidagi har recipient uchun notification yaratadi', async () => {
    await controller.orderCreated({
      orderId: '50',
      recipients: [{ userId: '10' }, { userId: '11' }],
    });
    expect(create).toHaveBeenCalledTimes(2);
  });
});
