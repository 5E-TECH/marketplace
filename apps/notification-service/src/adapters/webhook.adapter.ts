import { ConfigService } from '@nestjs/config';
import { AdapterMessage, NotificationAdapter } from './notification-adapter';
import { NotificationChannel } from '../entities/notification-delivery.entity';

export abstract class WebhookAdapter implements NotificationAdapter {
  abstract readonly channel: NotificationChannel;
  protected abstract readonly configKey: string;

  constructor(protected readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.config.get<string>(this.configKey));
  }

  async send(message: AdapterMessage): Promise<void> {
    const url = this.config.get<string>(this.configKey);
    if (!url) throw new Error(`${this.channel} adapter sozlanmagan`);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`${this.channel} provider HTTP ${response.status}`);
    }
  }
}
