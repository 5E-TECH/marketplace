import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { NotificationService } from './notification.service';
import {
  OrderCreatedEvent,
  SellerRegistrationCreatedEvent,
  ShopApprovedEvent,
  ShopRejectedEvent,
} from './notification.events';

@Controller()
export class NotificationEventsController {
  constructor(private readonly notifications: NotificationService) {}

  @EventPattern('seller.registration.created')
  sellerRegistered(@Payload() event: SellerRegistrationCreatedEvent) {
    return this.notifications.create({
      recipient: {
        userId: event.sellerUserId,
        email: event.email,
        phone: event.phone,
        telegramChatId: event.telegramChatId,
      },
      type: 'register',
      title: 'Arizangiz qabul qilindi',
      body: `${event.shopName} do‘koni ro‘yxatdan o‘tdi va tasdiqlash uchun yuborildi.`,
      data: { shopId: event.shopId },
    });
  }

  @EventPattern('shop.approved')
  shopApproved(@Payload() event: ShopApprovedEvent) {
    return this.notifications.create({
      recipient: {
        userId: event.sellerUserId,
        email: event.email,
        phone: event.phone,
        telegramChatId: event.telegramChatId,
      },
      type: 'shop_approved',
      title: 'Do‘kon tasdiqlandi',
      body: `${event.shopName} do‘koningiz faol holatga o‘tdi.`,
      data: { shopId: event.shopId },
    });
  }

  @EventPattern('shop.rejected')
  shopRejected(@Payload() event: ShopRejectedEvent) {
    return this.notifications.create({
      recipient: {
        userId: event.sellerUserId,
        email: event.email,
        phone: event.phone,
        telegramChatId: event.telegramChatId,
      },
      type: 'shop_rejected',
      title: 'Do‘kon rad etildi',
      body: `${event.shopName} do‘koningiz rad etildi.${
        event.reason ? ` Sabab: ${event.reason}` : ''
      }`,
      data: { shopId: event.shopId },
    });
  }

  @EventPattern('order.created')
  async orderCreated(@Payload() event: OrderCreatedEvent) {
    const orderLabel = event.orderNumber ?? event.orderId;
    await Promise.all(
      event.recipients.map((recipient) =>
        this.notifications.create({
          recipient,
          type: 'order_created',
          title: 'Yangi buyurtma',
          body: `${orderLabel} raqamli buyurtma yaratildi.`,
          data: { orderId: event.orderId, totalAmount: event.totalAmount },
        }),
      ),
    );
  }
}
