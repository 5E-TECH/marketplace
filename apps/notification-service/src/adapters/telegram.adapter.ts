import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationChannel } from '../entities/notification-delivery.entity';
import { AdapterMessage, NotificationAdapter } from './notification-adapter';

@Injectable()
export class TelegramAdapter implements NotificationAdapter {
  readonly channel = NotificationChannel.TELEGRAM;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('TELEGRAM_BOT_TOKEN'));
  }

  async send(message: AdapterMessage): Promise<void> {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) throw new Error('telegram adapter sozlanmagan');
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: message.recipient,
          text: `<b>${this.escape(message.title)}</b>\n${this.escape(message.body)}`,
          parse_mode: 'HTML',
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok)
      throw new Error(`telegram provider HTTP ${response.status}`);
  }

  private escape(value: string): string {
    return value.replace(
      /[&<>]/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]!,
    );
  }
}
