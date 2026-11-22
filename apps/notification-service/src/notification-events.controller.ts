import { Controller, Inject, Logger } from '@nestjs/common';
import { ClientProxy, EventPattern, Payload } from '@nestjs/microservices';
import {
  LOT_BLOCKED_EVENT,
  LotBlockedEvent,
  RmqClient,
  sendRpc,
} from '@app/common';
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
  private readonly logger = new Logger(NotificationEventsController.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly templates: NotificationTemplateService,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  /** BE-09 (TZ 2.6, NRX-6): to‘q sariq narx tasdiqlansa — har bir faol superadminga xabar. */
  @EventPattern('price.decision.orange')
  async priceOrange(
    @Payload()
    event: {
      productId: string;
      productName: string;
      price: number;
      recommended: number;
      reason: string | null;
      decidedBy: string;
    },
  ) {
    const recipients = await sendRpc<
      Array<{ id: string; phone: string; email: string | null }>
    >(
      this.identity,
      { cmd: 'identity.user.active-by-role' },
      { role: 'SUPERADMIN' },
    );
    if (!recipients.length) {
      this.logger.warn(
        `To‘q sariq narx (${event.productId}): faol superadmin yo‘q`,
      );
      return;
    }
    const content = await this.templates.render('price_orange', {
      productName: event.productName,
      price: event.price,
      recommended: event.recommended,
      reason: event.reason ?? '',
    });
    for (const user of recipients)
      await this.notifications.create({
        recipient: { userId: user.id, email: user.email, phone: user.phone },
        type: 'price_orange',
        ...content,
        data: { productId: event.productId, decidedBy: event.decidedBy },
      });
  }

  /** BE-17 (TZ OMB-3): partiya muddatiga 60 kundan kam qoldi — sotuvdan chiqdi; admin va superadminga. */
  @EventPattern(LOT_BLOCKED_EVENT)
  async lotBlocked(@Payload() event: LotBlockedEvent) {
    const recipients = new Map<
      string,
      { id: string; phone: string; email: string | null }
    >();
    for (const role of ['ADMIN', 'SUPERADMIN'])
      for (const user of await sendRpc<
        Array<{ id: string; phone: string; email: string | null }>
      >(this.identity, { cmd: 'identity.user.active-by-role' }, { role }))
        recipients.set(String(user.id), user);
    if (!recipients.size) {
      this.logger.warn('Partiya sotuvdan chiqdi: faol admin yo‘q');
      return;
    }
    const content = await this.templates.render('lot_blocked', {
      count: event.lots.length,
      list: event.lots
        .slice(0, 10)
        .map(
          (lot) =>
            `${lot.productName} (${lot.sku}${lot.batch ? `, ${lot.batch}` : ''}) — muddat ${lot.expiryDate}, ${lot.quantity} dona`,
        )
        .join('; '),
    });
    for (const user of recipients.values())
      await this.notifications.create({
        recipient: { userId: user.id, email: user.email, phone: user.phone },
        type: 'lot_blocked',
        ...content,
        data: { lots: event.lots.map((lot) => lot.lotId) },
      });
  }

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
