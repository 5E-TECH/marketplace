import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { FavoritesQueryDto, RpcHttpExceptionFilter } from '@app/common';
import { FavoriteService } from './favorite.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class FavoriteController {
  constructor(private readonly favorites: FavoriteService) {}
  @MessagePattern({ cmd: 'favorite.add' }) add(
    @Payload() d: { userId: string; productId: string },
  ) {
    return this.favorites.add(d.userId, d.productId);
  }
  @MessagePattern({ cmd: 'favorite.remove' }) remove(
    @Payload() d: { userId: string; productId: string },
  ) {
    return this.favorites.remove(d.userId, d.productId);
  }
  @MessagePattern({ cmd: 'favorite.check' }) check(
    @Payload() d: { userId: string; productId: string },
  ) {
    return this.favorites.check(d.userId, d.productId);
  }
  @MessagePattern({ cmd: 'favorite.list' }) list(
    @Payload() d: { userId: string; query: FavoritesQueryDto },
  ) {
    return this.favorites.list(d.userId, d.query);
  }
}
