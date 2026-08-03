import { NotificationService } from './notification.service';
import {
  DeliveryStatus,
  NotificationChannel,
} from './entities/notification-delivery.entity';

describe('NotificationService', () => {
  const notificationRepository = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => ({ id: '1', ...value })),
  };
  const deliveryRepository = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) =>
      value.map((item, index) => ({ id: String(index + 1), ...item })),
    ),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const emailAdapter = {
    channel: NotificationChannel.EMAIL,
    isConfigured: jest.fn(() => true),
    send: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

  it('adapter muvaffaqiyatida delivery SENT bo‘ladi', async () => {
    emailAdapter.send.mockResolvedValue(undefined);
    const service = new NotificationService(
      notificationRepository as never,
      deliveryRepository as never,
      [emailAdapter],
    );
    await service.create({
      recipient: {
        userId: '10',
        email: 'ali@example.com',
        channels: [NotificationChannel.EMAIL],
      },
      type: 'register',
      title: 'Title',
      body: 'Body',
    });
    expect(emailAdapter.send).toHaveBeenCalled();
    expect(deliveryRepository.update).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({ status: DeliveryStatus.SENT, attempts: 1 }),
    );
  });

  it('adapter xatosida notification saqlanib delivery RETRY bo‘ladi', async () => {
    emailAdapter.send.mockRejectedValue(new Error('provider unavailable'));
    const service = new NotificationService(
      notificationRepository as never,
      deliveryRepository as never,
      [emailAdapter],
    );
    const notification = await service.create({
      recipient: {
        userId: '10',
        email: 'ali@example.com',
        channels: [NotificationChannel.EMAIL],
      },
      type: 'register',
      title: 'Title',
      body: 'Body',
    });
    expect(notification.id).toBe('1');
    expect(deliveryRepository.update).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({
        status: DeliveryStatus.RETRY,
        attempts: 1,
        lastError: 'provider unavailable',
      }),
    );
  });
});
