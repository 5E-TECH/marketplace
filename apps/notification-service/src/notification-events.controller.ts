import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { NotificationService } from './notification.service';
import { NotificationTemplateService } from './notification-template.service';
import { TemplateKey } from './notification-templates';
import {
  OrderCreatedEvent,
  ProductHiddenEvent,
  OrderAdminActionEvent,
  ReturnStatusChangedEvent,
  SellerRegistrationCreatedEvent,
  ShopApprovedEvent,
  ShopRejectedEvent,
} from './notification.events';

@Controller()
export class NotificationEventsController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly templates: NotificationTemplateService,
  ) {}

  @EventPattern('seller.registration.created')
  async sellerRegistered(@Payload() event: SellerRegistrationCreatedEvent) {
    return this.notifications.create({
      recipient: {
        userId: event.sellerUserId,
        email: event.email,
        phone: event.phone,
        telegramChatId: event.telegramChatId,
      },
      type: 'register',
      ...(await this.templates.render('register', {
        shopName: event.shopName,
        sellerName: event.sellerName,
      })),
      data: { shopId: event.shopId },
    });
  }

  @EventPattern('shop.approved')
  async shopApproved(@Payload() event: ShopApprovedEvent) {
    return this.notifications.create({
      recipient: {
        userId: event.sellerUserId,
        email: event.email,
        phone: event.phone,
        telegramChatId: event.telegramChatId,
      },
      type: 'shop_approved',
      ...(await this.templates.render('shop_approved', {
        shopName: event.shopName,
      })),
      data: { shopId: event.shopId },
    });
  }

  @EventPattern('shop.rejected')
  async shopRejected(@Payload() event: ShopRejectedEvent) {
    return this.notifications.create({
      recipient: {
        userId: event.sellerUserId,
        email: event.email,
        phone: event.phone,
        telegramChatId: event.telegramChatId,
      },
      type: 'shop_rejected',
      ...(await this.templates.render('shop_rejected', {
        shopName: event.shopName,
        reason: event.reason ?? '',
        reasonSentence: event.reason ? ` Sabab: ${event.reason}` : '',
      })),
      data: { shopId: event.shopId },
    });
  }

  @EventPattern('product.hidden')
  async productHidden(@Payload() event: ProductHiddenEvent) {
    return this.notifications.create({
      recipient: { userId: event.sellerUserId },
      type: 'product_hidden',
      ...(await this.templates.render('product_hidden', {
        productName: event.productName,
        reason: event.reason,
      })),
      data: {
        productId: event.productId,
        shopId: event.shopId,
        reason: event.reason,
      },
    });
  }

  @EventPattern('order.created')
  async orderCreated(@Payload() event: OrderCreatedEvent) {
    const message = await this.templates.render('order_created', {
      orderNumber: event.orderNumber ?? event.orderId,
      totalAmount: event.totalAmount,
    });
    await Promise.all(
      event.recipients.map((recipient) =>
        this.notifications.create({
          recipient,
          type: 'order_created',
          ...message,
          data: { orderId: event.orderId, totalAmount: event.totalAmount },
        }),
      ),
    );
  }

  @EventPattern('order.cancelled')
  orderCancelled(@Payload() event: OrderAdminActionEvent) {
    return this.orderAction(event, 'order_cancelled');
  }

  @EventPattern('order.refunded')
  orderRefunded(@Payload() event: OrderAdminActionEvent) {
    return this.orderAction(event, 'order_refunded');
  }

  @EventPattern('return.status-changed')
  async returnStatusChanged(@Payload() event: ReturnStatusChangedEvent) {
    const titles: Record<ReturnStatusChangedEvent['status'], string> = {
      SUBMITTED: 'Yangi qaytarish so‘rovi',
      IN_REVIEW: 'Qaytarish so‘rovi ko‘rib chiqilmoqda',
      APPROVED: 'Qaytarish so‘rovi tasdiqlandi',
      REJECTED: 'Qaytarish so‘rovi rad etildi',
      REFUNDED: 'Qaytarish bo‘yicha pul qaytarildi',
    };
    const parts = [`#${event.orderId} buyurtma, so‘rov #${event.returnId}.`];
    if (event.amount !== undefined) {
      parts.push(`Summa: ${event.amount.toLocaleString('ru-RU')} so‘m.`);
    }
    if (event.comment) {
      parts.push(
        event.status === 'REJECTED'
          ? `Sabab: ${event.comment}`
          : `Izoh: ${event.comment}`,
      );
    }
    await Promise.all(
      event.recipients.map((recipient) =>
        this.notifications.create({
          recipient,
          type: `return_${event.status.toLowerCase()}`,
          title: titles[event.status] ?? 'Qaytarish so‘rovi yangilandi',
          body: parts.join(' '),
          data: {
            returnId: event.returnId,
            orderId: event.orderId,
            status: event.status,
          },
        }),
      ),
    );
  }

  private async orderAction(
    event: OrderAdminActionEvent,
    type: Extract<TemplateKey, 'order_cancelled' | 'order_refunded'>,
  ) {
    const message = await this.templates.render(type, {
      orderId: event.orderId,
      reason: event.reason,
    });
    await Promise.all(
      event.recipients.map((recipient) =>
        this.notifications.create({
          recipient,
          type,
          ...message,
          data: { orderId: event.orderId, reason: event.reason },
        }),
      ),
    );
  }
}
