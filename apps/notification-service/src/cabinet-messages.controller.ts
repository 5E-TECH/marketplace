import { Controller, Inject, Logger } from '@nestjs/common';
import { ClientProxy, EventPattern, Payload } from '@nestjs/microservices';
import {
  CatalogInventoryProduct,
  INBOUND_RECEIVED_EVENT,
  InboundReceivedEvent,
  InboundShipmentStatus,
  LEAD_OFFER_AFFILIATES_RPC,
  RmqClient,
  sendRpc,
  SETTLEMENT_PAID_EVENT,
  SettlementPaidEvent,
  STOCK_DEPLETED_EVENT,
  StockDepletedEvent,
} from '@app/common';
import { NotificationChannel } from './entities/notification-delivery.entity';
import { NotificationService } from './notification.service';

const money = (n: number) =>
  String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Optovik (`catalog.shop`): telefon va kabinet egasi (BE-30 gacha egasi yo‘q — faqat SMS). */
interface WholesalerContact {
  id: string;
  name: string | null;
  phone: string | null;
  ownerUserId: string | null;
}

/**
 * BE-47 (TZ 6.12): kabinet xabarlari — optovikka «Pul o‘tkazildi» (SMS va kabinet), «Postavka qabul qilindi, brak
 * topildi» (kabinet), sotuvchi va adminga «Offer qoldig‘i tugadi» (kabinet). Matnlar [taklif]; mijoz raqami va manzili
 * yo‘q. Bir hodisaga har qabul qiluvchiga bitta xabar (`dedupeKey`, TC6).
 */
@Controller()
export class CabinetMessagesController {
  private readonly logger = new Logger(CabinetMessagesController.name);

  constructor(
    private readonly notifications: NotificationService,
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
    @Inject(RmqClient.LEAD) private readonly lead: ClientProxy,
  ) {}

  /** TC3: optovikka haftalik o‘tkazma to‘landi — SMS (EQ-03 adapteri) va kabinet xabari. */
  @EventPattern(SETTLEMENT_PAID_EVENT)
  async onSettlementPaid(@Payload() event: SettlementPaidEvent): Promise<void> {
    if (!event?.settlementId || !event.wholesalerId) return;
    const wholesaler = await this.wholesaler(event.wholesalerId);
    if (!wholesaler) return;
    if (!wholesaler.phone && !wholesaler.ownerUserId) {
      this.logger.warn(
        `Optovik ${event.wholesalerId}: telefon ham, kabinet ham yo‘q — «Pul o‘tkazildi» yuborilmadi`,
      );
      return;
    }
    await this.notifications.create({
      recipient: {
        userId: wholesaler.ownerUserId,
        phone: wholesaler.phone,
        channels: wholesaler.phone ? [NotificationChannel.SMS] : [],
      },
      type: 'wholesaler_paid',
      title: 'Pul o‘tkazildi',
      body: `Elchi Market: ${event.periodStart} – ${event.periodEnd} davri uchun ${money(event.amount)} so‘m o‘tkazildi (akt ${event.number}).`,
      data: { settlementId: event.settlementId, number: event.number },
      dedupeKey: `settlement:${event.settlementId}:PAID`,
    });
  }

  /** TC2: postavka qabul qilindi (brak bo‘lsa soni bilan) — optovik kabineti (BE-30 gacha kabinet yo‘q bo‘lsa — yo‘q). */
  @EventPattern(INBOUND_RECEIVED_EVENT)
  async onInboundReceived(
    @Payload() event: InboundReceivedEvent,
  ): Promise<void> {
    if (!event?.shipmentId || !event.wholesalerId) return;
    const wholesaler = await this.wholesaler(event.wholesalerId);
    if (!wholesaler?.ownerUserId) return;
    const defective = Number(event.defectiveQty) || 0;
    // «qabul» — yaroqlisi (kelgan − brak), qabul akti va kabinetdagi akt bilan bir xil (dizayn `hujjat-qabul-akti`)
    const accepted = Math.max(0, (Number(event.receivedQty) || 0) - defective);
    const parts = [`${accepted} dona qabul qilindi`];
    if (defective > 0) parts.push(`brak ${defective} dona`);
    // kam yoki ortiq kelgan bo‘lsa — e’lon qilingan soni ham; jami teng, lekin qatorlarda farq bor (bir mahsulot ortiq,
    // boshqasi kam) — postavka DISCREPANCY, shuning uchun holat bo‘yicha ham
    const lineDiff =
      event.status === InboundShipmentStatus.DISCREPANCY && defective === 0;
    if (event.receivedQty !== event.declaredQty || lineDiff)
      parts.push(`e’lon qilingan ${event.declaredQty} dona`);
    await this.notifications.create({
      recipient: { userId: wholesaler.ownerUserId, channels: [] },
      type: defective > 0 ? 'inbound_defect' : 'inbound_received',
      title:
        defective > 0
          ? 'Postavka qabul qilindi, brak topildi'
          : 'Postavka qabul qilindi',
      body: `Postavka ${event.number}: ${parts.join(', ')}.`,
      data: { shipmentId: event.shipmentId, number: event.number },
      dedupeKey: `inbound:${event.shipmentId}:received`,
    });
  }

  /** TC4: offer qoldig‘i 0 — admin, superadmin va shu offerda sahifasi bor sotuvchilarga (kuniga bir marta [taklif]). */
  @EventPattern(STOCK_DEPLETED_EVENT)
  async onStockDepleted(@Payload() event: StockDepletedEvent): Promise<void> {
    const variantIds = (event?.variantIds ?? []).map(String).filter(Boolean);
    if (!variantIds.length) return;
    const products = await sendRpc<CatalogInventoryProduct[]>(
      this.catalog,
      { cmd: 'inventory.variant-details' },
      { shopId: null, variantIds },
    );
    // «kuniga bir marta» — Toshkent kuni
    const at = new Date(String(event.at ?? ''));
    const day = (
      Number.isNaN(at.getTime()) ? new Date() : at
    ).toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' });
    const staff = (
      await Promise.all(
        ['ADMIN', 'SUPERADMIN'].map((role) =>
          sendRpc<Array<{ id: string }>>(
            this.identity,
            { cmd: 'identity.user.active-by-role' },
            { role },
          ),
        ),
      )
    )
      .flat()
      .map((user) => String(user.id));
    for (const product of products ?? []) {
      const write = (userId: string) =>
        this.notifications.create({
          recipient: { userId, channels: [] },
          type: 'offer_out_of_stock',
          title: 'Offer qoldig‘i tugadi',
          body: `«${product.productName}» omborda qolmadi — yangi buyurtma qoldiq kelguncha yaratilmaydi.`,
          data: { productId: String(product.productId) },
          dedupeKey: `stock:${product.variantId}:${day}:user:${userId}`,
        });
      // avval xodimlar — lid-service javob bermasa ham admin xabarni oladi
      for (const userId of new Set(staff)) await write(userId);
      let affiliates: string[] = [];
      try {
        affiliates = await sendRpc<string[]>(
          this.lead,
          { cmd: LEAD_OFFER_AFFILIATES_RPC },
          { productId: String(product.productId) },
        );
      } catch (error) {
        this.logger.warn(
          `«Qoldiq tugadi» (${product.productId}): sotuvchilar olinmadi — ${(error as Error)?.message}`,
        );
      }
      for (const userId of new Set(affiliates ?? []))
        if (!staff.includes(userId)) await write(userId);
    }
  }

  private async wholesaler(id: string): Promise<WholesalerContact | null> {
    try {
      const shop = await sendRpc<WholesalerContact>(
        this.catalog,
        { cmd: 'catalog.shop.get-by-id' },
        { shopId: String(id) },
      );
      return {
        id: String(shop.id),
        name: shop.name ?? null,
        phone: shop.phone ?? null,
        ownerUserId: shop.ownerUserId == null ? null : String(shop.ownerUserId),
      };
    } catch (error) {
      const status = Number((error as { status?: number })?.status ?? 0);
      // optovik yo‘q (4xx) — xabar tashlanadi; katalog ishlamasa — xato qaytadi (notification navbatida qayta urinish
      // yo‘q — hodisa DLQ ga, `ops:rmq-dlq-replay` bilan qaytariladi)
      if (status >= 400 && status < 500) {
        this.logger.warn(`Optovik topilmadi (${id})`);
        return null;
      }
      throw error;
    }
  }
}
