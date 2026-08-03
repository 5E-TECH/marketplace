import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationChannel } from '../entities/notification-delivery.entity';
import { WebhookAdapter } from './webhook.adapter';

@Injectable()
export class SmsAdapter extends WebhookAdapter {
  readonly channel = NotificationChannel.SMS;
  protected readonly configKey = 'SMS_WEBHOOK_URL';

  constructor(config: ConfigService) {
    super(config);
  }
}
