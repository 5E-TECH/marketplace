import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { runAsLeader } from '@app/common';
import { NotificationService } from './notification.service';

@Injectable()
export class DeliveryRetryService {
  constructor(
    private readonly notifications: NotificationService,
    private readonly dataSource: DataSource,
  ) {}

  /** BE-03: bir nechta nusxada faqat qulfni olgan nusxa qayta yuboradi. */
  @Cron('*/30 * * * * *', {
    name: 'notification-delivery-retry',
    waitForCompletion: true,
  })
  async retryDueTick(): Promise<void> {
    await runAsLeader(this.dataSource, 'notification-delivery-retry', () =>
      this.retryDue(),
    );
  }

  retryDue() {
    return this.notifications.retryDue();
  }
}
