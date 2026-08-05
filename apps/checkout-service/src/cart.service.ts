import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  AddCartItemDto,
  CartCatalogVariantDto,
  CartDto,
  CartOwnerDto,
} from '@app/common';
import { Cart } from './entities/cart.entity';
import { CartItem } from './entities/cart-item.entity';

@Injectable()
export class CartService {
  constructor(private readonly dataSource: DataSource) {}

  async get(owner: CartOwnerDto): Promise<CartDto> {
    this.assertOwner(owner);
    const cart = await this.findActive(this.dataSource.manager, owner);
    return this.toDto(cart);
  }

  async add(
    owner: CartOwnerDto,
    dto: AddCartItemDto,
    variant: CartCatalogVariantDto,
  ): Promise<CartDto> {
    this.assertOwner(owner);
    if (
      dto.productId !== variant.productId ||
      dto.variantId !== variant.variantId
    ) {
      throw new BadRequestException('Mahsulot va variant bir-biriga mos emas');
    }
    return this.dataSource.transaction(async (manager) => {
      const cart = await this.getOrCreate(manager, owner);
      const repository = manager.getRepository(CartItem);
      const existing = await repository.findOne({
        where: { cartId: cart.id, variantId: dto.variantId },
      });
      if (existing) {
        existing.quantity += dto.quantity;
        existing.unitPriceSnapshot = variant.unitPrice;
        existing.productId = variant.productId;
        existing.shopId = variant.shopId;
        await repository.save(existing);
      } else {
        await repository.save(
          repository.create({
            cartId: cart.id,
            productId: variant.productId,
            variantId: variant.variantId,
            shopId: variant.shopId,
            quantity: dto.quantity,
            unitPriceSnapshot: variant.unitPrice,
          }),
        );
      }
      return this.toDto(await this.findById(manager, cart.id));
    });
  }

  async update(
    owner: CartOwnerDto,
    itemId: string,
    quantity: number,
  ): Promise<CartDto> {
    this.assertOwner(owner);
    return this.dataSource.transaction(async (manager) => {
      const cart = await this.requiredCart(manager, owner);
      const item = await manager.getRepository(CartItem).findOne({
        where: { id: itemId, cartId: cart.id },
      });
      if (!item) throw new NotFoundException('Savat elementi topilmadi');
      item.quantity = quantity;
      await manager.getRepository(CartItem).save(item);
      return this.toDto(await this.findById(manager, cart.id));
    });
  }

  async remove(owner: CartOwnerDto, itemId: string): Promise<CartDto> {
    this.assertOwner(owner);
    return this.dataSource.transaction(async (manager) => {
      const cart = await this.requiredCart(manager, owner);
      const result = await manager.getRepository(CartItem).delete({
        id: itemId,
        cartId: cart.id,
      });
      if (!result.affected)
        throw new NotFoundException('Savat elementi topilmadi');
      return this.toDto(await this.findById(manager, cart.id));
    });
  }

  async merge(customerId: string, sessionId: string): Promise<CartDto> {
    if (!customerId || !sessionId) {
      throw new BadRequestException('customerId va sessionId majburiy');
    }
    return this.dataSource.transaction(async (manager) => {
      const carts = manager.getRepository(Cart);
      const sessionCart = await this.findActive(manager, { sessionId });
      let userCart = await this.findActive(manager, { customerId });
      if (!sessionCart) return this.toDto(userCart);
      if (!userCart) {
        sessionCart.customerId = customerId;
        sessionCart.sessionId = null;
        await carts.save(sessionCart);
        return this.toDto(await this.findById(manager, sessionCart.id));
      }
      if (userCart.id === sessionCart.id) return this.toDto(userCart);

      const items = manager.getRepository(CartItem);
      for (const source of sessionCart.items) {
        const target = userCart.items.find(
          (item) => item.variantId === source.variantId,
        );
        if (target) {
          target.quantity += source.quantity;
          target.unitPriceSnapshot = source.unitPriceSnapshot;
          await items.save(target);
          await items.delete(source.id);
        } else {
          source.cartId = userCart.id;
          await items.save(source);
        }
      }
      sessionCart.status = 'converted';
      await carts.save(sessionCart);
      userCart = (await this.findById(manager, userCart.id))!;
      return this.toDto(userCart);
    });
  }

  private assertOwner(owner: CartOwnerDto) {
    if (!owner.customerId && !owner.sessionId) {
      throw new BadRequestException('x-session-id yoki login talab qilinadi');
    }
  }

  private async getOrCreate(manager: EntityManager, owner: CartOwnerDto) {
    const existing = await this.findActive(manager, owner);
    if (existing) return existing;
    return manager.getRepository(Cart).save(
      manager.getRepository(Cart).create({
        customerId: owner.customerId ?? null,
        sessionId: owner.customerId ? null : (owner.sessionId ?? null),
        status: 'active',
      }),
    );
  }

  private async requiredCart(manager: EntityManager, owner: CartOwnerDto) {
    const cart = await this.findActive(manager, owner);
    if (!cart) throw new NotFoundException('Faol savat topilmadi');
    return cart;
  }

  private findActive(manager: EntityManager, owner: CartOwnerDto) {
    const where = owner.customerId
      ? { customerId: owner.customerId, status: 'active' }
      : { sessionId: owner.sessionId, status: 'active' };
    return manager
      .getRepository(Cart)
      .findOne({ where, relations: { items: true } });
  }

  private findById(manager: EntityManager, id: string) {
    return manager
      .getRepository(Cart)
      .findOne({ where: { id }, relations: { items: true } });
  }

  private toDto(cart: Cart | null): CartDto {
    const items = (cart?.items ?? []).map((item) => ({
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      shopId: item.shopId,
      quantity: item.quantity,
      unitPriceSnapshot: Number(item.unitPriceSnapshot),
      lineTotal: Number(item.unitPriceSnapshot) * item.quantity,
    }));
    return {
      id: cart?.id ?? null,
      customerId: cart?.customerId ?? null,
      sessionId: cart?.sessionId ?? null,
      items,
      totalAmount: items.reduce((sum, item) => sum + item.lineTotal, 0),
      totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    };
  }
}
