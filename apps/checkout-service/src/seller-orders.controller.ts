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
      ownerUserId: string;
      query: SellerOrdersQueryDto;
    },
  ) {
    const shop = await this.shop(data.ownerUserId);
    return this.orders.findAll(shop.id, data.query);
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
