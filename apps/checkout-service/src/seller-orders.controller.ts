import {
  ConflictException,
  Controller,
  NotFoundException,
  UseFilters,
  ForbiddenException,
} from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { LeadOrderActorType, Role, RpcHttpExceptionFilter } from '@app/common';
import {
  SellerOrdersService,
  ShippingLabelTarget,
} from './seller-orders.service';
import {
  ShippingLabelData,
  ShippingLabelService,
  SkippedShippingLabel,
} from './shipping-label.service';
import { LeadOrderStatusService } from './lead-order-status.service';
import { FulfillmentService } from './fulfillment.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class SellerOrdersController {
  constructor(
    private readonly orders: SellerOrdersService,
    private readonly labels: ShippingLabelService,
    private readonly leadOrders: LeadOrderStatusService,
    private readonly fulfillment: FulfillmentService,
  ) {}

  /** Admin: `orderId` = sales_order.id — buyurtmaning barcha posilkalari. */
  @MessagePattern({ cmd: 'checkout.admin.order-label' })
  async adminLabel(@Payload() data: { orderId: string }) {
    // BE-19: lid buyurtmasi — telefon, SOATO va posilka `parcel` da (eski yorliq ularni manzil matnidan o‘qirdi)
    if (await this.leadOrders.isLeadOrder(String(data?.orderId ?? '')))
      return this.fulfillment.label(String(data.orderId));
    const { targets, missing } = await this.orders.adminShippingLabelTargets([
      String(data.orderId),
    ]);
    if (!targets.length) throw new NotFoundException(missing[0].reason);
    return this.batchLabels(targets);
  }

  @MessagePattern({ cmd: 'checkout.admin.order-labels' })
  async adminLabelsBatch(@Payload() data: { orderIds: string[] }) {
    // BE-19: lid buyurtmalari — o‘z yorlig‘i (telefon, SOATO, posilka `parcel` da); qolganlari eski tartibda
    const orderIds = (data?.orderIds ?? []).map(String);
    const leadIds = await this.fulfillment.leadOrderIds(orderIds);
    const lead = await this.fulfillment.collectLabels(leadIds);
    const legacyIds = orderIds.filter((id) => !leadIds.includes(id));
    const { targets, missing } = legacyIds.length
      ? await this.orders.adminShippingLabelTargets(legacyIds)
      : { targets: [], missing: [] };
    return this.batchLabels(targets, missing, lead, orderIds);
  }

  /** Admin: bitta posilka (buyurtma tafsilotidagi do'kon bo'limi). */
  @MessagePattern({ cmd: 'checkout.admin.seller-order-label' })
  async adminSellerOrderLabel(
    @Payload() data: { orderId: string; sellerOrderId: string },
  ) {
    // BE-19: lid buyurtmasida posilka bitta
    if (await this.leadOrders.isLeadOrder(String(data?.orderId ?? '')))
      return this.fulfillment.label(String(data.orderId));
    return this.labels.generate(
      await this.orders.getShippingLabelDataForAdmin(
        String(data.orderId),
        String(data.sellerOrderId),
      ),
    );
  }

  @MessagePattern({ cmd: 'checkout.admin.shipment-tokens-sync' })
  adminSyncShipmentTokens(
    @Payload() data: { afterId?: string; limit?: number; dryRun?: boolean },
  ) {
    return this.orders.syncShipmentTokens(data ?? {});
  }

  /**
   * Chiqqan yorliqlar bitta PDF; chiqmaganlari `skipped` da. Birortasi ham
   * chiqmasa — 409 va har biri sababi bilan (foydalanuvchi nimani tuzatishni
   * ko'rsin).
   */
  private async batchLabels(
    targets: ShippingLabelTarget[],
    missing: SkippedShippingLabel[] = [],
    lead: { labels: ShippingLabelData[]; skipped: SkippedShippingLabel[] } = {
      labels: [],
      skipped: [],
    },
    requested?: string[],
  ) {
    const collected = targets.length
      ? await this.orders.collectShippingLabels(targets)
      : { labels: [], skipped: [] };
    const labels = [...lead.labels, ...collected.labels];
    // admin so‘ragan tartibda (lid va eski buyurtmalar aralash bo‘lsa ham); bir buyurtma posilkalari o‘z tartibida
    if (requested?.length) {
      const position = new Map(requested.map((id, index) => [id, index]));
      labels.sort(
        (a, b) =>
          (position.get(String(a.salesOrderId)) ?? Infinity) -
          (position.get(String(b.salesOrderId)) ?? Infinity),
      );
    }
    const skipped = [...lead.skipped, ...collected.skipped];
    const all = [...missing, ...skipped];
    if (!labels.length) {
      // Sabab bo'yicha guruhlanadi: 100 ta buyurtmada ham xabar qisqa
      // qoladi (frontend uzun server matnini ko'rsatmaydi).
      const byReason = new Map<string, Set<string>>();
      for (const item of all) {
        const ids = byReason.get(item.reason) ?? new Set<string>();
        ids.add(`#${item.orderId}`);
        byReason.set(item.reason, ids);
      }
      throw new ConflictException(
        `Yorliq chiqmadi — ${[...byReason]
          .map(([reason, ids]) => `${reason}: ${[...ids].join(', ')}`)
          .join('; ')}`,
      );
    }
    return this.labels.generateBatch(labels, all);
  }

  @MessagePattern({ cmd: 'checkout.admin.stats' })
  adminStats() {
    return this.orders.adminStats();
  }

  @MessagePattern({ cmd: 'checkout.admin.orders-list' })
  adminListOrders(
    @Payload()
    data: {
      query?: {
        status?: string;
        paymentMethod?: string;
        shopId?: string;
        dateFrom?: string;
        dateTo?: string;
        page?: number;
        limit?: number;
      };
    },
  ) {
    return this.orders.adminListOrders(data?.query ?? {});
  }

  @MessagePattern({ cmd: 'checkout.admin.order-get' })
  adminGetOrder(@Payload() data: { orderId: string }) {
    return this.orders.adminGetOrder(String(data.orderId));
  }

  @MessagePattern({ cmd: 'checkout.admin.order-cancel' })
  async adminCancelOrder(
    @Payload()
    data: {
      orderId: string;
      reason: string;
      actorId: string;
      actorRole?: string;
    },
  ) {
    // BE-18: lid buyurtmasi — Elchi’ga topshirilgunga qadar, sabab bilan, band darhol bo‘shaydi (BUY-3)
    if (await this.leadOrders.isLeadOrder(String(data?.orderId ?? ''))) {
      const result = await this.leadOrders.cancel({
        orderId: String(data.orderId),
        reason: data.reason,
        actor: {
          type: LeadOrderActorType.USER,
          id: String(data.actorId),
          role: data.actorRole ?? null,
        },
      });
      return {
        id: result.id,
        status: result.status,
        idempotent: result.idempotent,
      };
    }
    // Eski buyurtmani (to‘lovi bilan) faqat admin va superadmin bekor qiladi — nazoratchi faqat lid buyurtmasini
    if (data?.actorRole === Role.SUPERVISOR)
      throw new ForbiddenException(
        'Nazoratchi faqat liddan kelgan buyurtmani bekor qila oladi',
      );
    return this.orders.adminCancelOrder(data);
  }

  @MessagePattern({ cmd: 'checkout.admin.order-refund' })
  adminRefundOrder(
    @Payload()
    data: {
      orderId: string;
      reason: string;
      amount?: number;
      actorId: string;
    },
  ) {
    return this.orders.adminRefundOrder(data);
  }
}
