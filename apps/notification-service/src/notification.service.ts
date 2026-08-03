import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, Repository } from 'typeorm';
import { NotificationsQueryDto } from '@app/common';
import {
  NOTIFICATION_ADAPTERS,
  NotificationAdapter,
} from './adapters/notification-adapter';
import {
  DeliveryStatus,
  NotificationChannel,
  NotificationDelivery,
} from './entities/notification-delivery.entity';
import { Notification } from './entities/notification.entity';
import { NotificationRecipient } from './notification.events';

interface CreateNotificationInput {
  recipient: NotificationRecipient;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly maxAttempts = 5;

  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    @InjectRepository(NotificationDelivery)
    private readonly deliveries: Repository<NotificationDelivery>,
    @Inject(NOTIFICATION_ADAPTERS)
    private readonly adapters: NotificationAdapter[],
  ) {}

  async create(input: CreateNotificationInput): Promise<Notification> {
    const notification = await this.notifications.save(
      this.notifications.create({
        userId: input.recipient.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data ?? {},
        isRead: false,
        readAt: null,
      }),
    );
    const channels = input.recipient.channels ?? [
      NotificationChannel.EMAIL,
      NotificationChannel.TELEGRAM,
      NotificationChannel.SMS,
    ];
    const pending = channels.map((channel) =>
      this.deliveries.create({
        notificationId: notification.id,
        channel,
        recipient: this.recipientFor(input.recipient, channel),
        status: DeliveryStatus.PENDING,
        attempts: 0,
        nextRetryAt: new Date(),
        lastError: null,
        sentAt: null,
      }),
    );
    const savedDeliveries = pending.length
      ? await this.deliveries.save(pending)
      : [];
    await Promise.allSettled(
      savedDeliveries.map((delivery) =>
        this.attemptDelivery(delivery, notification),
      ),
    );
    return notification;
  }

  async findAll(userId: string, query: NotificationsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      userId,
      ...(query.unreadOnly === 'true' ? { isRead: false } : {}),
    };
    const [[items, total], unreadCount] = await Promise.all([
      this.notifications.findAndCount({
        where,
        order: { createdAt: 'DESC' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.notifications.count({ where: { userId, isRead: false } }),
    ]);
    return { items, total, unreadCount, page, limit };
  }

  async markRead(userId: string, id: string): Promise<Notification> {
    const notification = await this.notifications.findOne({
      where: { id, userId },
    });
    if (!notification) throw new NotFoundException('Xabarnoma topilmadi');
    if (!notification.isRead) {
      notification.isRead = true;
      notification.readAt = new Date();
      await this.notifications.save(notification);
    }
    return notification;
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.notifications.update(
      { userId, isRead: false },
      { isRead: true, readAt: new Date() },
    );
    return { updated: result.affected ?? 0 };
  }

  async retryDue(): Promise<number> {
    const due = await this.deliveries.find({
      where: {
        status: In([DeliveryStatus.PENDING, DeliveryStatus.RETRY]),
        nextRetryAt: LessThanOrEqual(new Date()),
      },
      order: { nextRetryAt: 'ASC' },
      take: 50,
    });
    for (const delivery of due) {
      const claimed = await this.deliveries.update(
        { id: delivery.id, status: delivery.status },
        { status: DeliveryStatus.PROCESSING },
      );
      if (!claimed.affected) continue;
      const notification = await this.notifications.findOneBy({
        id: delivery.notificationId,
      });
      if (notification) await this.attemptDelivery(delivery, notification);
    }
    return due.length;
  }

  private async attemptDelivery(
    delivery: NotificationDelivery,
    notification: Notification,
  ): Promise<void> {
    const adapter = this.adapters.find(
      (item) => item.channel === delivery.channel,
    );
    if (!adapter || !adapter.isConfigured() || !delivery.recipient) {
      await this.deliveries.update(delivery.id, {
        status: DeliveryStatus.SKIPPED,
        nextRetryAt: null,
        lastError: !delivery.recipient
          ? 'Qabul qiluvchi manzili yo‘q'
          : 'Adapter sozlanmagan',
      });
      return;
    }
    const attempts = delivery.attempts + 1;
    try {
      await adapter.send({
        recipient: delivery.recipient,
        title: notification.title,
        body: notification.body,
      });
      await this.deliveries.update(delivery.id, {
        status: DeliveryStatus.SENT,
        attempts,
        sentAt: new Date(),
        nextRetryAt: null,
        lastError: null,
      });
    } catch (error) {
      const failed = attempts >= this.maxAttempts;
      const message = (error as Error).message.slice(0, 2000);
      await this.deliveries.update(delivery.id, {
        status: failed ? DeliveryStatus.FAILED : DeliveryStatus.RETRY,
        attempts,
        nextRetryAt: failed ? null : this.nextRetry(attempts),
        lastError: message,
      });
      this.logger.warn(
        `${delivery.channel} delivery ${delivery.id} urinishi ${attempts} xato: ${message}`,
      );
    }
  }

  private recipientFor(
    recipient: NotificationRecipient,
    channel: NotificationChannel,
  ): string | null {
    if (channel === NotificationChannel.EMAIL) return recipient.email ?? null;
    if (channel === NotificationChannel.SMS) return recipient.phone ?? null;
    return recipient.telegramChatId ?? null;
  }

  private nextRetry(attempts: number): Date {
    const delayMinutes = Math.min(2 ** (attempts - 1), 60);
    return new Date(Date.now() + delayMinutes * 60_000);
  }
}
