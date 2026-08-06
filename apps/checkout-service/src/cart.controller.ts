import { Controller, Inject, UseFilters } from '@nestjs/common';
import { ClientProxy, MessagePattern, Payload } from '@nestjs/microservices';
import {
  AddCartItemDto,
  CartCatalogVariantDto,
  CartOwnerDto,
  RmqClient,
  RpcHttpExceptionFilter,
  sendRpc,
} from '@app/common';
import { CartService } from './cart.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class CartController {
  constructor(
    private readonly carts: CartService,
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
  ) {}

  @MessagePattern({ cmd: 'cart.get' })
  get(@Payload() data: { owner: CartOwnerDto }) {
    return this.carts.get(data.owner);
  }

  @MessagePattern({ cmd: 'cart.item.add' })
  async add(@Payload() data: { owner: CartOwnerDto; dto: AddCartItemDto }) {
    const variant = await sendRpc<CartCatalogVariantDto>(
      this.catalog,
      { cmd: 'cart.variant.get' },
      { productId: data.dto.productId, variantId: data.dto.variantId },
    );
    return this.carts.add(data.owner, data.dto, variant);
  }

  @MessagePattern({ cmd: 'cart.item.update' })
  update(
    @Payload() data: { owner: CartOwnerDto; itemId: string; quantity: number },
  ) {
    return this.carts.update(data.owner, data.itemId, data.quantity);
  }

  @MessagePattern({ cmd: 'cart.item.remove' })
  remove(@Payload() data: { owner: CartOwnerDto; itemId: string }) {
    return this.carts.remove(data.owner, data.itemId);
  }

  @MessagePattern({ cmd: 'cart.merge' })
  merge(@Payload() data: { customerId: string; sessionId: string }) {
    return this.carts.merge(data.customerId, data.sessionId);
  }
}
