import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationService } from './notification.service';

@Injectable()
export class DeliveryRetryService {
  constructor(private readonly notifications: NotificationService) {}

  @Cron('*/30 * * * * *')
  retryDue() {
    return this.notifications.retryDue();
  }
}
