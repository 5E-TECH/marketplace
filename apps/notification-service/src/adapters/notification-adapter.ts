import { NotificationChannel } from '../entities/notification-delivery.entity';

export interface AdapterMessage {
  recipient: string;
  title: string;
  body: string;
}

export interface NotificationAdapter {
  readonly channel: NotificationChannel;
  isConfigured(): boolean;
  send(message: AdapterMessage): Promise<void>;
}

export const NOTIFICATION_ADAPTERS = Symbol('NOTIFICATION_ADAPTERS');
