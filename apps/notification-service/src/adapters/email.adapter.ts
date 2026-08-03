import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationChannel } from '../entities/notification-delivery.entity';
import { WebhookAdapter } from './webhook.adapter';

@Injectable()
export class EmailAdapter extends WebhookAdapter {
  readonly channel = NotificationChannel.EMAIL;
  protected readonly configKey = 'EMAIL_WEBHOOK_URL';

  constructor(config: ConfigService) {
    super(config);
  }
}
