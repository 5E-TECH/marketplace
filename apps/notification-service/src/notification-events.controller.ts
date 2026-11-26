import { Controller, Inject, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { ClientProxy, EventPattern, Payload } from '@nestjs/microservices';
import {
  COD_RECONCILIATION_MISMATCH_EVENT,
  ELCHI_CHECK_MISMATCH_EVENT,
  ElchiCheckMismatchEvent,
  CodReconciliationMismatchEvent,
  ELCHI_STATUS_CONFLICT_EVENT,
  ElchiStatusConflictEvent,
  LOT_BLOCKED_EVENT,
  LotBlockedEvent,
  RmqClient,
  sendRpc,
  WITHDRAWAL_CONFLICT_EVENT,
  WITHDRAWAL_FAILED_EVENT,
  WITHDRAWAL_OVERDUE_EVENT,
  WithdrawalConflictEvent,
  WithdrawalFailedEvent,
  WithdrawalOverdueEvent,
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

  /** BE-21 (TZ ELC-4, bildirishnomalar «Sverka farqi» → nazoratchi va moliya): kunlik sverkada farq. */
  @EventPattern(COD_RECONCILIATION_MISMATCH_EVENT)
  async codMismatch(@Payload() event: CodReconciliationMismatchEvent) {
    const recipients = await this.financeAndSupervisors();
    if (!recipients.length) {
      this.logger.warn(
        `Sverka farqi (${event.date}): faol moliya yoki nazoratchi yo‘q`,
      );
      return;
    }
    const content = await this.templates.render('cod_reconciliation_mismatch', {
      date: event.date,
      mismatchCount: event.mismatchCount,
      diffTotal: event.diffTotal,
    });
    for (const user of recipients)
      await this.notifications.create({
        recipient: { userId: user.id, email: user.email, phone: user.phone },
        type: 'cod_reconciliation_mismatch',
        ...content,
        data: { date: event.date, orders: event.orders },
      });
  }

  /** BE-46 TC3: kunlik avtomatik Elchi tekshiruvida yangi farq — moliya va nazoratchiga. */
  @EventPattern(ELCHI_CHECK_MISMATCH_EVENT)
  async elchiCheckMismatch(@Payload() event: ElchiCheckMismatchEvent) {
    const recipients = await this.financeAndSupervisors();
    if (!recipients.length) {
      this.logger.warn(
        `Elchi tekshiruvi farqi (${event.date}): faol moliya yoki nazoratchi yo‘q`,
      );
      return;
    }
    const content = await this.templates.render('elchi_check_mismatch', {
      date: event.date,
      newDiffCount: event.newDiffCount,
      openDiffCount: event.openDiffCount,
      orders: (event.orders ?? []).map((order) => order.orderNumber).join(', '),
    });
    for (const user of recipients)
      await this.notifications.create({
        recipient: { userId: user.id, email: user.email, phone: user.phone },
        type: 'elchi_check_mismatch',
        ...content,
        data: { date: event.date, runId: event.runId, orders: event.orders },
      });
  }

  /** BE-21: Elchi yetkazilgan sotuvni bekor qildi — buyurtma o‘zgarmaydi, moliya va nazoratchi qo‘lda hal qiladi. */
  @EventPattern(ELCHI_STATUS_CONFLICT_EVENT)
  async elchiStatusConflict(@Payload() event: ElchiStatusConflictEvent) {
    const recipients = await this.financeAndSupervisors();
    if (!recipients.length) {
      this.logger.warn(
        `Elchi holati zid (${event.orderId}): faol moliya yoki nazoratchi yo‘q`,
      );
      return;
    }
    const content = await this.templates.render('elchi_status_conflict', {
      orderId: event.orderId,
      orderStatus: event.orderStatus,
      elchiStatus: event.elchiStatus,
    });
    for (const user of recipients)
      await this.notifications.create({
        recipient: { userId: user.id, email: user.email, phone: user.phone },
        type: 'elchi_status_conflict',
        ...content,
        data: {
          orderId: event.orderId,
          shipmentId: event.shipmentId,
          eventId: event.eventId,
        },
      });
  }

  /** BE-32: kartaga o‘tmadi — moliyaga (sotuvchiga alohida, `OrderSmsController`). */
  @EventPattern(WITHDRAWAL_FAILED_EVENT)
  async withdrawalPayoutFailed(@Payload() event: WithdrawalFailedEvent) {
    if (!event?.withdrawalId) return;
    const recipients = await this.byRoles(['FINANCE']);
    if (!recipients.length) {
      this.logger.warn(
        `Kartaga o‘tmadi (${event.withdrawalId}): faol moliya xodimi yo‘q`,
      );
      return;
    }
    const content = await this.templates.render('withdrawal_payout_failed', {
      withdrawalId: event.withdrawalId,
      affiliateId: event.affiliateId,
      net: event.net,
      cardMask: event.cardMask ?? '',
      reason: event.reason,
    });
    for (const user of recipients)
      await this.notifications.create({
        recipient: { userId: user.id, email: user.email, phone: user.phone },
        type: 'withdrawal_payout_failed',
        ...content,
        data: { withdrawalId: event.withdrawalId },
        dedupeKey: `withdrawal:${event.withdrawalId}:FAILED:${user.id}`,
      });
  }

  /** BE-32 (T01:498): 24 soatdan beri to‘lanmagan so‘rovlar — moliyaga. */
  @EventPattern(WITHDRAWAL_OVERDUE_EVENT)
  async withdrawalOverdue(@Payload() event: WithdrawalOverdueEvent) {
    const items = event?.withdrawals ?? [];
    if (!items.length) return;
    const recipients = await this.byRoles(['FINANCE']);
    if (!recipients.length) {
      this.logger.warn('Pul yechish 24 soatdan oshdi: faol moliya xodimi yo‘q');
      return;
    }
    const content = await this.templates.render('withdrawal_overdue', {
      count: items.length,
      withdrawals: items
        .slice(0, 20)
        .map(
          (w) =>
            `${w.id} — ${w.status}${w.kind === 'NO_RESULT' ? ' (javob yo‘q)' : ''}`,
        )
        .join(', '),
    });
    for (const user of recipients)
      await this.notifications.create({
        recipient: { userId: user.id, email: user.email, phone: user.phone },
        type: 'withdrawal_overdue',
        ...content,
        data: { withdrawals: items.map((w) => w.id) },
        // RMQ qayta yuborsa — bitta xabar
        dedupeKey: `withdrawal-overdue:${createHash('sha256')
          .update(items.map((w) => `${w.id}:${w.kind}`).join(','))
          .digest('hex')
          .slice(0, 32)}:${user.id}`,
      });
  }

  /** BE-32: provayder natijasi so‘rov holatiga zid — moliyaga. */
  @EventPattern(WITHDRAWAL_CONFLICT_EVENT)
  async withdrawalPayoutConflict(@Payload() event: WithdrawalConflictEvent) {
    if (!event?.withdrawalId) return;
    const recipients = await this.byRoles(['FINANCE']);
    if (!recipients.length) {
      this.logger.warn(
        `Kartaga to‘lov ziddiyati (${event.withdrawalId}): faol moliya xodimi yo‘q`,
      );
      return;
    }
    const content = await this.templates.render('withdrawal_payout_conflict', {
      withdrawalId: event.withdrawalId,
      affiliateId: event.affiliateId,
      net: event.net,
      conflict: event.conflict,
    });
    for (const user of recipients)
      await this.notifications.create({
        recipient: { userId: user.id, email: user.email, phone: user.phone },
        type: 'withdrawal_payout_conflict',
        ...content,
        data: { withdrawalId: event.withdrawalId },
        dedupeKey: `withdrawal:${event.withdrawalId}:CONFLICT:${user.id}`,
      });
  }

  private async byRoles(
    roles: string[],
  ): Promise<Array<{ id: string; phone: string; email: string | null }>> {
    const recipients = new Map<
      string,
      { id: string; phone: string; email: string | null }
    >();
    for (const role of roles)
      for (const user of await sendRpc<
        Array<{ id: string; phone: string; email: string | null }>
      >(this.identity, { cmd: 'identity.user.active-by-role' }, { role }))
        recipients.set(String(user.id), user);
    return [...recipients.values()];
  }

  /** Moliya va nazoratchi (ikki rolda bitta odam — bir marta). */
  private async financeAndSupervisors(): Promise<
    Array<{ id: string; phone: string; email: string | null }>
  > {
    const recipients = new Map<
      string,
      { id: string; phone: string; email: string | null }
    >();
    for (const role of ['FINANCE', 'SUPERVISOR'])
      for (const user of await sendRpc<
        Array<{ id: string; phone: string; email: string | null }>
      >(this.identity, { cmd: 'identity.user.active-by-role' }, { role }))
        recipients.set(String(user.id), user);
    return [...recipients.values()];
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
