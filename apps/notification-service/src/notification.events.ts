import { NotificationChannel } from './entities/notification-delivery.entity';

export interface NotificationRecipient {
  userId: string;
  email?: string | null;
  phone?: string | null;
  telegramChatId?: string | null;
  channels?: NotificationChannel[];
}

export interface SellerRegistrationCreatedEvent {
  sellerUserId: string;
  shopId: string;
  sellerName: string;
  shopName: string;
  email?: string | null;
  phone?: string | null;
  telegramChatId?: string | null;
}

export interface ShopApprovedEvent {
  sellerUserId: string;
  shopId: string;
  shopName: string;
  email?: string | null;
  phone?: string | null;
  telegramChatId?: string | null;
}

export interface ShopRejectedEvent {
  sellerUserId: string;
  shopId: string;
  shopName: string;
  reason?: string | null;
  email?: string | null;
  phone?: string | null;
  telegramChatId?: string | null;
}

export interface OrderCreatedEvent {
  orderId: string;
  orderNumber?: string;
  recipients: NotificationRecipient[];
  totalAmount?: number;
}
