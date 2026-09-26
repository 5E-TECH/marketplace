import {
  ConflictException,
  Controller,
  Inject,
  NotFoundException,
  UseFilters,
} from '@nestjs/common';
import { ClientProxy, MessagePattern, Payload } from '@nestjs/microservices';
import {
  RmqClient,
  RpcHttpExceptionFilter,
  SellerOrdersQueryDto,
  sendRpc,
  StockPageDto,
} from '@app/common';
import {
  SellerOrdersService,
  ShippingLabelTarget,
} from './seller-orders.service';
import {
  ShippingLabelService,
  SkippedShippingLabel,
} from './shipping-label.service';

interface SellerShop {
  id: string;
}

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class SellerOrdersController {
  constructor(
    private readonly orders: SellerOrdersService,
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
    @Inject(RmqClient.INVENTORY) private readonly inventory: ClientProxy,
    private readonly labels: ShippingLabelService,
  ) {}

  @MessagePattern({ cmd: 'seller.orders.list' })
  async list(
    @Payload()
    data: {
      ownerUserId?: string;
      shopId?: string;
      query: SellerOrdersQueryDto;
    },
  ) {
    const shopId = await this.resolveShopId(data);
    return this.orders.findAll(shopId, data.query);
  }

  /** Buyurtma holatini yangilash (owner yoki operator; shop bo'yicha scope). */
  @MessagePattern({ cmd: 'seller.orders.update-status' })
  async updateStatus(
    @Payload()
    data: {
      ownerUserId?: string;
      shopId?: string;
      orderId: string;
      status: string;
    },
  ) {
    const shopId = await this.resolveShopId(data);
    return this.orders.updateStatus(shopId, String(data.orderId), data.status);
  }

  @MessagePattern({ cmd: 'seller.orders.get' }) async get(@Payload() d: any) {
    return this.orders.getSellerOrder(
      await this.resolveShopId(d),
      String(d.orderId),
    );
  }
  @MessagePattern({ cmd: 'seller.orders.items' }) async items(
    @Payload() d: any,
  ) {
    return this.orders.getItems(await this.resolveShopId(d), String(d.orderId));
  }
  @MessagePattern({ cmd: 'seller.orders.history' }) async history(
    @Payload() d: any,
  ) {
    return this.orders.history(await this.resolveShopId(d), String(d.orderId));
  }
  @MessagePattern({ cmd: 'seller.shipments.list' }) async shipments(
    @Payload() d: any,
  ) {
    return this.orders.shipments(await this.resolveShopId(d), d.query);
  }
  @MessagePattern({ cmd: 'seller.shipments.get' }) async shipment(
    @Payload() d: any,
  ) {
    return this.orders.getSellerOrder(
      await this.resolveShopId(d),
      String(d.shipmentId),
    );
  }
  @MessagePattern({ cmd: 'seller.shipments.tracking' }) async tracking(
    @Payload() d: any,
  ) {
    const o: any = await this.orders.getSellerOrder(
      await this.resolveShopId(d),
      String(d.shipmentId),
    );
    return {
      shipmentId: o.elchiShipmentId,
      status: o.status,
      trackingUrl: o.trackingUrl,
      updatedAt: o.updatedAt,
    };
  }
  @MessagePattern({ cmd: 'seller.shipments.create' }) async createShipment(
    @Payload() d: any,
  ) {
    return this.orders.createShipment(
      await this.resolveShopId(d),
      String(d.orderId),
      d.customerPhone,
    );
  }

  @MessagePattern({ cmd: 'seller.orders.label' }) async label(
    @Payload() d: any,
  ) {
    const data = await this.orders.getShippingLabelData(
      await this.resolveShopId(d),
      String(d.orderId),
    );
    return this.labels.generate(data);
  }

  @MessagePattern({ cmd: 'seller.orders.labels' })
  async labelsBatch(
    @Payload()
    data: {
      ownerUserId?: string;
      shopId?: string;
      orderIds: string[];
    },
  ) {
    const shopId = await this.resolveShopId(data);
    return this.batchLabels(
      data.orderIds.map((id) => ({
        shopId,
        sellerOrderId: String(id),
        orderId: String(id),
      })),
    );
  }

  /** Admin: `orderId` = sales_order.id — buyurtmaning barcha posilkalari. */
  @MessagePattern({ cmd: 'checkout.admin.order-label' })
  async adminLabel(@Payload() data: { orderId: string }) {
    const { targets, missing } = await this.orders.adminShippingLabelTargets([
      String(data.orderId),
    ]);
    if (!targets.length) throw new NotFoundException(missing[0].reason);
    return this.batchLabels(targets);
  }

  @MessagePattern({ cmd: 'checkout.admin.order-labels' })
  async adminLabelsBatch(@Payload() data: { orderIds: string[] }) {
    const { targets, missing } = await this.orders.adminShippingLabelTargets(
      data.orderIds,
    );
    return this.batchLabels(targets, missing);
  }

  /** Admin: bitta posilka (buyurtma tafsilotidagi do'kon bo'limi). */
  @MessagePattern({ cmd: 'checkout.admin.seller-order-label' })
  async adminSellerOrderLabel(
    @Payload() data: { orderId: string; sellerOrderId: string },
  ) {
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
  ) {
    const { labels, skipped } =
      await this.orders.collectShippingLabels(targets);
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

  /** Scope: operator → JWT shopId (to'g'ridan); owner → ownerUserId'dan resolve. */
  private async resolveShopId(data: {
    ownerUserId?: string;
    shopId?: string;
  }): Promise<string> {
    if (data.shopId) return String(data.shopId);
    const shop = await this.shop(String(data.ownerUserId));
    return shop.id;
  }

  @MessagePattern({ cmd: 'checkout.admin.stats' })
  adminStats() {
    return this.orders.adminStats();
  }

  @MessagePattern({ cmd: 'checkout.order.tracking' })
  buyerTracking(
    @Payload()
    data: {
      orderId: string;
      customerId?: string;
      sessionId?: string;
    },
  ) {
    return this.orders.buyerTracking(
      data.orderId,
      data.customerId,
      data.sessionId,
    );
  }

  @MessagePattern({ cmd: 'checkout.order.details' })
  buyerOrderDetails(
    @Payload()
    data: {
      orderId: string;
      customerId?: string;
      sessionId?: string;
    },
  ) {
    return this.orders.buyerOrderDetails(
      data.orderId,
      data.customerId,
      data.sessionId,
    );
  }

  @MessagePattern({ cmd: 'checkout.order.refund' })
  buyerRefundOrder(
    @Payload()
    data: {
      orderId: string;
      reason: string;
      customerId?: string;
      sessionId?: string;
    },
  ) {
    return this.orders.buyerRefundOrder(data);
  }

  @MessagePattern({ cmd: 'checkout.orders.list-by-buyer' })
  buyerOrders(
    @Payload()
    data: {
      customerId: string;
      query?: { page?: number; limit?: number };
    },
  ) {
    return this.orders.buyerOrders(data.customerId, data.query);
  }

  @MessagePattern({ cmd: 'checkout.orders.count-by-shop' })
  countByShop(@Payload() data: { shopId: string }) {
    return this.orders.countByShop(String(data.shopId));
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
  adminCancelOrder(
    @Payload() data: { orderId: string; reason: string; actorId: string },
  ) {
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

  @MessagePattern({ cmd: 'seller.dashboard.get' })
  async dashboard(@Payload() data: { ownerUserId: string }) {
    const shop = await this.shop(data.ownerUserId);
    const lowStock = await sendRpc<StockPageDto>(
      this.inventory,
      { cmd: 'inventory.stock.low' },
      {
        ownerUserId: data.ownerUserId,
        query: { page: 1, limit: 1, lowOnly: true },
      },
    );
    return this.orders.dashboard(shop.id, lowStock.total);
  }

  private shop(ownerUserId: string): Promise<SellerShop> {
    return sendRpc(
      this.catalog,
      { cmd: 'seller.shop.get-me' },
      { ownerUserId },
    );
  }
}
