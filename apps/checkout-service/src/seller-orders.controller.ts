import { Controller, Inject, UseFilters } from '@nestjs/common';
import { ClientProxy, MessagePattern, Payload } from '@nestjs/microservices';
import {
  RmqClient,
  RpcHttpExceptionFilter,
  SellerOrdersQueryDto,
  sendRpc,
  StockPageDto,
} from '@app/common';
import { SellerOrdersService } from './seller-orders.service';

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

  /** Scope: operator → JWT shopId (to'g'ridan); owner → ownerUserId'dan resolve. */
  private async resolveShopId(data: {
    ownerUserId?: string;
    shopId?: string;
  }): Promise<string> {
    if (data.shopId) return String(data.shopId);
    const shop = await this.shop(String(data.ownerUserId));
    return shop.id;
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
