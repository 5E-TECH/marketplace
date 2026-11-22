import { Controller, Inject, Logger } from '@nestjs/common';
import { ClientProxy, EventPattern, Payload } from '@nestjs/microservices';
import {
  ORDER_EVENTS,
  OrderStatusChangedEvent,
  RmqClient,
  sendRpc,
} from '@app/common';
import { NotificationChannel } from './entities/notification-delivery.entity';
import { NotificationService } from './notification.service';
import {
  CUSTOMER_SMS_STATUSES,
  customerSmsText,
  WithdrawalPaidEvent,
  withdrawalPaidText,
} from './order-sms';

export const WITHDRAWAL_PAID_EVENT = 'finance.withdrawal.paid';

/**
 * BE-24 (BUY-6, TZ 6.12): mijozga buyurtma SMS lari (tasdiqlandi, yo‘lga chiqdi + trek, yetkazildi) va sotuvchiga
 * «pul o‘tkazildi». Yetkazish va qayta urinish — `NotificationService` (provayder javob bermasa 24 soatgacha).
 * Bir hodisaga bir SMS (`dedupeKey`). Hamma SMS bitta adapter orqali (`SMS_WEBHOOK_URL`; EQ-03 dan keyin provayder).
 */
@Controller()
export class OrderSmsController {
  private readonly logger = new Logger(OrderSmsController.name);

  constructor(
    private readonly notifications: NotificationService,
    @Inject(RmqClient.INTEGRATION) private readonly integration: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  @EventPattern(ORDER_EVENTS.STATUS_CHANGED)
  async onOrderStatus(
    @Payload() event: OrderStatusChangedEvent,
  ): Promise<void> {
    if (!event?.orderId || !CUSTOMER_SMS_STATUSES.has(event.status)) return;
    const phone = event.recipient?.phone;
    if (!phone) return;
    const text = customerSmsText(event, await this.districtName(event));
    if (!text) return;
    await this.notifications.create({
      recipient: { userId: null, phone, channels: [NotificationChannel.SMS] },
      ...text,
      data: {
        orderId: event.orderId,
        orderNumber: event.orderNumber,
        status: event.status,
      },
      dedupeKey: `order:${event.orderId}:${event.status}`,
    });
  }

  @EventPattern(WITHDRAWAL_PAID_EVENT)
  async onWithdrawalPaid(@Payload() event: WithdrawalPaidEvent): Promise<void> {
    if (!event?.withdrawalId || !event.affiliateId) return;
    const user = await sendRpc<{ id: string; phone?: string | null }>(
      this.identity,
      { cmd: 'identity.user.admin-get' },
      { userId: String(event.affiliateId) },
    ).catch((error: Error) => {
      this.logger.warn(
        `Sotuvchi topilmadi (${event.affiliateId}): ${error.message}`,
      );
      return null;
    });
    if (!user) return;
    // SMS va kabinet xabari (xabar-pul: «natijani SMS va kabinet xabari bilan oladi»)
    await this.notifications.create({
      recipient: {
        userId: String(event.affiliateId),
        phone: user.phone ?? null,
        channels: [NotificationChannel.SMS],
      },
      type: 'withdrawal_paid',
      title: 'Pul o‘tkazildi',
      body: withdrawalPaidText(event),
      data: { withdrawalId: event.withdrawalId },
      dedupeKey: `withdrawal:${event.withdrawalId}:PAID`,
    });
  }

  /** Tuman nomi Elchi geo keshidan («Qo‘qon shahri»); olinmasa — joysiz matn. */
  private async districtName(
    event: OrderStatusChangedEvent,
  ): Promise<string | null> {
    const r = event.recipient;
    if (!r?.regionSoato || !r?.districtSoato) return null;
    try {
      const res = await sendRpc<{ ok: boolean; districtName?: string }>(
        this.integration,
        { cmd: 'integration.geo.resolve-address' },
        { regionSoato: r.regionSoato, districtSoato: r.districtSoato },
      );
      return res?.ok && res.districtName ? res.districtName : null;
    } catch {
      return null;
    }
  }
}
