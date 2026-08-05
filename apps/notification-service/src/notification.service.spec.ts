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
  const telegramAdapter = {
    channel: NotificationChannel.TELEGRAM,
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

  it('TC2: email va telegram adapterlarini chaqiradi', async () => {
    emailAdapter.send.mockResolvedValue(undefined);
    telegramAdapter.send.mockResolvedValue(undefined);
    const service = new NotificationService(
      notificationRepository as never,
      deliveryRepository as never,
      [emailAdapter, telegramAdapter],
    );

    await service.create({
      recipient: {
        userId: '10',
        email: 'ali@example.com',
        telegramChatId: '998877',
        channels: [NotificationChannel.EMAIL, NotificationChannel.TELEGRAM],
      },
      type: 'shop_approved',
      title: 'Do‘kon tasdiqlandi',
      body: 'Do‘koningiz faol.',
    });

    expect(emailAdapter.send).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: 'ali@example.com' }),
    );
    expect(telegramAdapter.send).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: '998877' }),
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

  it('TC3: due RETRY deliveryni worker qayta yuboradi', async () => {
    const delivery = {
      id: '7',
      notificationId: '1',
      channel: NotificationChannel.EMAIL,
      recipient: 'ali@example.com',
      status: DeliveryStatus.RETRY,
      attempts: 1,
      nextRetryAt: new Date('2026-08-05T10:00:00.000Z'),
    };
    const notification = { id: '1', title: 'Title', body: 'Body' };
    const notifications = {
      findOneBy: jest.fn().mockResolvedValue(notification),
    };
    const deliveries = {
      find: jest.fn().mockResolvedValue([delivery]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    emailAdapter.send.mockResolvedValue(undefined);
    const service = new NotificationService(
      notifications as never,
      deliveries as never,
      [emailAdapter],
    );

    await expect(service.retryDue()).resolves.toBe(1);
    expect(deliveries.update).toHaveBeenNthCalledWith(
      1,
      { id: '7', status: DeliveryStatus.RETRY },
      { status: DeliveryStatus.PROCESSING },
    );
    expect(emailAdapter.send).toHaveBeenCalledWith({
      recipient: 'ali@example.com',
      title: 'Title',
      body: 'Body',
    });
    expect(deliveries.update).toHaveBeenLastCalledWith(
      '7',
      expect.objectContaining({ status: DeliveryStatus.SENT, attempts: 2 }),
    );
  });

  it('TC1: in-app ro‘yxat faqat tegishli user xabarlarini so‘raydi', async () => {
    const notifications = {
      findAndCount: jest.fn().mockResolvedValue([[{ id: '1' }], 1]),
      count: jest.fn().mockResolvedValue(1),
    };
    const service = new NotificationService(
      notifications as never,
      {} as never,
      [],
    );

    await expect(
      service.findAll('10', { page: 1, limit: 20, unreadOnly: 'true' }),
    ).resolves.toEqual({
      items: [{ id: '1' }],
      total: 1,
      unreadCount: 1,
      page: 1,
      limit: 20,
    });
    expect(notifications.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: '10', isRead: false } }),
    );
    expect(notifications.count).toHaveBeenCalledWith({
      where: { userId: '10', isRead: false },
    });
  });
});
